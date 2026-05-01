'use client';
import { useState, useRef, useEffect } from 'react';
import { motion, useMotionValue, useMotionValueEvent, useDragControls } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = typeof window !== "undefined" ? `${window.location.origin}/api/supabase` : process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

type CanvasItem = {
  id: string; type: 'photo' | 'text'; content: string;
  x: number; y: number; width?: number; height?: number; 
};

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<CanvasItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSize, setUploadSize] = useState(256);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const scale = useMotionValue(1);
  const panX = useMotionValue(0);
  const panY = useMotionValue(0);
  const [scaleUI, setScaleUI] = useState(1); 
  useMotionValueEvent(scale, "change", (latest) => setScaleUI(latest));

  const dragControls = useDragControls();

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isPlacing, setIsPlacing] = useState(false);
  const [placeMode, setPlaceMode] = useState<'selected' | 'all' | null>(null);

  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);

  // 🌟 [新增] 备份系统的状态
  const [backups, setBackups] = useState<any[]>([]);
  const [showBackups, setShowBackups] = useState(false);

  const dragCtx = useRef<{ id: string | null, startX: number, startY: number, initX: number, initY: number }>({ 
    id: null, startX: 0, startY: 0, initX: 0, initY: 0 
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setIsLoggedIn(!!session));
    supabase.auth.onAuthStateChange((_event, session) => setIsLoggedIn(!!session));
    fetchItems();
    fetchBackups(); // 初始拉取备份列表
  }, []);

  const fetchItems = async () => {
    const { data } = await supabase.from('canvas_items').select('*');
    if (data) setItems(data.map(item => ({
      id: item.id, type: item.item_type, content: item.content,
      x: item.pos_x, y: item.pos_y, width: item.width, height: item.height 
    })));
  };

  // 🌟 拉取云端的存档备份
  const fetchBackups = async () => {
    const { data } = await supabase.from('gallery_backups').select('*').order('created_at', { ascending: false });
    if (data) setBackups(data);
  };

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) { alert("画廊修改权限已解锁！"); setShowLogin(false); }
    else alert("邮箱或密码错误！");
  };
  
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsSelectMode(false); setSelectedIds([]); setIsPlacing(false); setPlaceMode(null); setShowBackups(false);
    alert("已锁定画廊，现在是公共浏览模式。");
  };

  // ================= 🌟 备份核心逻辑 =================
  const createBackup = async () => {
    const name = prompt("给你的宇宙快照起个名字吧（比如：凌乱风格v1）：", `备份 ${new Date().toLocaleTimeString()}`);
    if (!name) return;
    
    // 把当前画板上的所有元素原封不动存进 JSON
    const { error } = await supabase.from('gallery_backups').insert({ name, data: items });
    if (!error) {
      alert("🚀 当前宇宙快照保存成功！");
      fetchBackups();
      setShowBackups(false);
    } else {
      alert("备份失败，请检查 Supabase 表是否建好！");
    }
  };

  const restoreBackup = async (backupId: string) => {
    if (!confirm("⚠️ 警告：时光倒流会抹除当前画板上的所有内容，替换为选中备份的状态。确定要继续吗？")) return;
    
    const backup = backups.find(b => b.id === backupId);
    if (!backup) return;

    // 1. 删除当前表里的所有数据
    const currentIds = items.map(i => i.id);
    if (currentIds.length > 0) {
      await supabase.from('canvas_items').delete().in('id', currentIds);
    }

    // 2. 将备份的数据重新写入表里
    const newDbItems = backup.data.map((item: any) => ({
      item_type: item.type, content: item.content,
      pos_x: item.x, pos_y: item.y, width: item.width, height: item.height
    }));
    
    if (newDbItems.length > 0) {
      await supabase.from('canvas_items').insert(newDbItems);
    }

    // 3. 刷新前端页面
    fetchItems();
    alert("✨ 时光倒流完毕，画廊已恢复到过去的某一个月亮节点！");
    setShowBackups(false);
  };

  const deleteBackup = async (backupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要销毁这个快照碎片吗？")) return;
    await supabase.from('gallery_backups').delete().eq('id', backupId);
    fetchBackups();
  };
  // ==================================================

  const getCanvasPos = (screenX: number, screenY: number) => {
    const cx = window.innerWidth / 2; const cy = window.innerHeight / 2;
    const s = scale.get();
    return { x: cx + (screenX - cx - panX.get()) / s, y: cy + (screenY - cy - panY.get()) / s };
  };

  const handleWheel = (e: React.WheelEvent) => {
    if(e.ctrlKey) return; 
    panX.set(panX.get() - e.deltaX); 
    panY.set(panY.get() - e.deltaY);
  };

  const startDragItem = (id: string, initX: number, initY: number, e: React.PointerEvent) => {
    if (!isLoggedIn || isSelectMode || isPlacing) return;
    e.stopPropagation(); 
    dragCtx.current = { id, startX: e.clientX, startY: e.clientY, initX, initY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const doDragItem = (e: React.PointerEvent) => {
    if (dragCtx.current.id) {
      const s = scale.get();
      const dx = (e.clientX - dragCtx.current.startX) / s;
      const dy = (e.clientY - dragCtx.current.startY) / s;
      setItems(prev => prev.map(item => item.id === dragCtx.current.id ? { ...item, x: dragCtx.current.initX + dx, y: dragCtx.current.initY + dy } : item));
    }
  };

  const stopDragItem = async (e: React.PointerEvent) => {
    const id = dragCtx.current.id;
    if (id) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      dragCtx.current.id = null; 

      const targetItem = items.find(i => i.id === id);
      if (targetItem) {
        await supabase.from('canvas_items').update({ pos_x: targetItem.x, pos_y: targetItem.y }).eq('id', id);
      }
    }
  };

  const handleDoubleClick = async (e: React.MouseEvent) => {
    if (!isLoggedIn || isPlacing) return; 
    if ((e.target as HTMLElement).id === 'canvas-handle') {
      const { x: startX, y: startY } = getCanvasPos(e.clientX - 60, e.clientY - 15);
      const tempId = Date.now().toString();

      setItems(prev => [...prev, { id: tempId, type: 'text', content: '✍️ 点击修改', x: startX, y: startY, width: 200, height: 50 }]);
      const { data } = await supabase.from('canvas_items').insert({
        item_type: 'text', content: '✍️ 点击修改', pos_x: startX, pos_y: startY, width: 200, height: 50
      }).select().single();
      if (data) setItems(prev => prev.map(item => item.id === tempId ? { ...item, id: data.id } : item));
    }
  };

  // ... (简化展示，后面的上传、拖拽、整理功能等一刀未剪全部保留，请向下直接拉到底部代码框并复制)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploading(true);
    const newCanvasItems: CanvasItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = `${Date.now()}_${i}.${file.name.split('.').pop()}`; 
      const { error: uploadError } = await supabase.storage.from('photos').upload(fileName, file);
      if (uploadError) continue; 

      const photoUrl = supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;
      const { x: startX, y: startY } = getCanvasPos(window.innerWidth / 2 - uploadSize / 2 + (i*40), window.innerHeight / 2 - uploadSize / 2 + (i*40));

      const { data } = await supabase.from('canvas_items').insert({
        item_type: 'photo', content: photoUrl, pos_x: startX, pos_y: startY, width: uploadSize, height: uploadSize
      }).select().single();

      if (data) newCanvasItems.push({ id: data.id, type: data.item_type, content: data.content, x: data.pos_x, y: data.pos_y, width: data.width, height: data.height });
    }
    if (newCanvasItems.length > 0) setItems(prev => [...prev, ...newCanvasItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsUploading(false);
  };

  const handleDelete = async (id: string, e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
    setItems(prev => prev.filter(item => item.id !== id));
    await supabase.from('canvas_items').delete().eq('id', id);
  };

  const handleResizeEnd = async (id: string, newWidth: number, newHeight: number) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, width: newWidth, height: newHeight } : item));
    await supabase.from('canvas_items').update({ width: newWidth, height: newHeight }).eq('id', id);
  };

  const updateText = async (id: string, newContent: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, content: newContent } : item));
    await supabase.from('canvas_items').update({ content: newContent }).eq('id', id);
  };

  const prepareReArrange = (mode: 'selected' | 'all') => { setPlaceMode(mode); setIsPlacing(true); };

  const executeArrange = async (targetCenterX: number, targetCenterY: number) => {
    const targetItems = placeMode === 'selected' 
      ? items.filter(i => selectedIds.includes(i.id)) 
      : items.filter(i => i.type === 'photo');
    if (targetItems.length === 0) return;

    const cols = Math.ceil(Math.sqrt(targetItems.length));
    const gap = 40; 
    const layoutMap: {id: string, x: number, y: number}[] = [];
    let curX = 0, curY = 0, rowMaxH = 0, maxOffsetX = 0, maxOffsetY = 0;

    targetItems.forEach((item, index) => {
      if (index > 0 && index % cols === 0) { curX = 0; curY += rowMaxH + gap; rowMaxH = 0; }
      layoutMap.push({ id: item.id, x: curX, y: curY });
      curX += (item.width || 256) + gap;
      rowMaxH = Math.max(rowMaxH, item.height || 256);
      maxOffsetX = Math.max(maxOffsetX, curX - gap); 
      maxOffsetY = Math.max(maxOffsetY, curY + (item.height || 256));
    });

    const startX = targetCenterX - (maxOffsetX / 2); 
    const startY = targetCenterY - (maxOffsetY / 2);
    const newItems = [...items]; 
    const updates: {id: string, pos_x: number, pos_y: number}[] = [];

    layoutMap.forEach((pos) => {
      const fX = startX + pos.x; 
      const fY = startY + pos.y;
      const vIndex = newItems.findIndex(i => i.id === pos.id);
      newItems[vIndex] = { ...newItems[vIndex], x: fX, y: fY };
      updates.push({ id: pos.id, pos_x: fX, pos_y: fY });
    });

    setItems(newItems); setIsPlacing(false); setPlaceMode(null); setIsSelectMode(false); setSelectedIds([]);
    await Promise.all(updates.map(u => supabase.from('canvas_items').update({ pos_x: u.pos_x, pos_y: u.pos_y }).eq('id', u.id)));
  };

  const handleItemClick = (id: string, e: React.MouseEvent) => {
    if (!isSelectMode || isPlacing) return;
    e.stopPropagation();
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  return (
    <main 
      className={`relative w-screen h-screen overflow-hidden bg-[#f4f4f2] ${isPlacing ? 'cursor-crosshair' : ''}`}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
    >
      <input type="file" accept="image/*" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {/* --- 顶部控制台 --- */}
      <div className="absolute top-6 left-6 z-50 flex flex-col items-start gap-4 pointer-events-none">
        <div>
          <h1 className="text-3xl font-bold text-zinc-800 tracking-tighter">My Canvas.</h1>
          <p className="text-sm text-zinc-500 mt-1 drop-shadow-sm font-medium">
            {isLoggedIn ? "拖拽排版 / 双击放大 / 双击空地加字" : "双击全屏放大 / 按住屏幕空地平移"}
          </p>
        </div>
        
        {isLoggedIn && (
          <div className="flex flex-wrap items-center gap-3 pointer-events-auto bg-white/90 p-2 rounded-2xl shadow-sm backdrop-blur-md border border-white/50">
            {isPlacing ? (
              <div className="flex items-center gap-4 px-4 py-2 text-sm rounded-xl font-bold bg-yellow-400 text-black shadow-lg animate-bounce border border-yellow-500">
                <span>👇 请点击下方空地选择阵列中心</span>
                <button onClick={() => { setIsPlacing(false); setPlaceMode(null); }} className="px-2 py-1 bg-black/10 hover:bg-black/20 rounded-md transition-colors">取消</button>
              </div>
            ) : (
              <>
                <button onClick={() => { setIsSelectMode(!isSelectMode); setSelectedIds([]); }}
                  className={`px-3 py-2 text-sm rounded-xl font-bold transition-all shadow-sm ${isSelectMode ? 'bg-blue-100 text-blue-600 border border-blue-300' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                  {isSelectMode ? "✅ 退出多选" : "🔲 多选阵列"}
                </button>
                {!isSelectMode && (
                  <button onClick={() => prepareReArrange('all')} className="px-3 py-2 text-sm rounded-xl font-bold transition-all bg-purple-600 text-white hover:bg-purple-500 shadow-sm">
                    🌌 整理全图 
                  </button>
                )}
                {isSelectMode && selectedIds.length > 0 && (
                  <button onClick={() => prepareReArrange('selected')} className="px-4 py-2 text-sm rounded-xl font-bold transition-all bg-blue-600 text-white hover:bg-blue-500 shadow-lg animate-pulse">
                    ✨ 整理 ({selectedIds.length})
                  </button>
                )}
                {!isSelectMode && (
                  <>
                    <div className="flex items-center gap-2 text-sm text-zinc-600 pl-2 border-l border-zinc-200">
                      <span>大小：</span>
                      <select value={uploadSize} onChange={(e) => setUploadSize(Number(e.target.value))} className="bg-transparent font-bold outline-none cursor-pointer">
                        <option value={150}>小图</option>
                        <option value={256}>中图</option>
                        <option value={400}>大图</option>
                        <option value={600}>超大</option>
                      </select>
                    </div>
                    <button onClick={() => fileInputRef.current?.click()} disabled={isUploading || isPlacing} className={`px-4 py-2 text-sm rounded-xl shadow-lg transition-all text-white ${isUploading ? 'bg-zinc-400' : 'bg-zinc-900 hover:scale-105'}`}>
                      + 批量上传
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="absolute bottom-6 left-6 z-50 flex items-center bg-white/90 backdrop-blur-md shadow-lg rounded-full px-4 py-2 border border-black/5 gap-4">
        <button onClick={() => scale.set(Math.max(0.1, scale.get() / 1.2))} className="text-xl px-2 hover:scale-125 transition-transform text-zinc-600">−</button>
        <button onClick={() => { scale.set(1); panX.set(0); panY.set(0); }} className="text-xs font-bold w-12 text-center text-zinc-700 hover:text-black">
          {Math.round(scaleUI * 100)}%
        </button>
        <button onClick={() => scale.set(Math.min(5, scale.get() * 1.2))} className="text-xl px-2 hover:scale-125 transition-transform text-zinc-600">+</button>
      </div>

      <motion.div
        className="absolute top-0 left-0 w-screen h-screen"
        style={{ x: panX, y: panY, scale }}
        drag={!isPlacing} 
        dragListener={false}            
        dragControls={dragControls}     
        dragMomentum={true}
      >
        <div 
          id="canvas-handle"
          className="absolute active:cursor-grabbing"
          style={{ width: '10000vw', height: '10000vh', left: '-5000vw', top: '-5000vh', backgroundImage: 'radial-gradient(#d4d4d8 1.5px, transparent 1.5px)', backgroundSize: `48px 48px`, backgroundPosition: 'center center' }}
          onPointerDown={(e) => {
            if (!isPlacing) dragControls.start(e);
          }}
          onClick={(e) => {
            if (isPlacing) {
               const { x, y } = getCanvasPos(e.clientX, e.clientY);
               executeArrange(x, y);
            }
          }}
        />

        {items.map((item) => {
          const isSelected = selectedIds.includes(item.id);

          if (item.type === 'photo') {
            return (
              <motion.div
                key={item.id}
                className={`absolute shadow-lg p-2 bg-white pb-8 group
                  ${isLoggedIn && !isSelectMode && !isPlacing ? 'cursor-grab active:cursor-grabbing' : ''}
                  ${isSelectMode && !isPlacing ? 'cursor-pointer hover:bg-blue-50' : ''}
                  ${isSelected ? 'ring-4 ring-blue-500 ring-offset-2 z-[60]' : ''}
                  ${isPlacing ? 'pointer-events-none opacity-50' : ''} 
                `}
                style={{ left: item.x, top: item.y }}
                onPointerDown={(e) => startDragItem(item.id, item.x, item.y, e)}
                onPointerMove={doDragItem}
                onPointerUp={stopDragItem}
                onPointerCancel={stopDragItem}

                onClick={(e) => handleItemClick(item.id, e)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isSelectMode && !isPlacing) setFullscreenPhoto(item.content);
                }}
              >
                {isLoggedIn && !isSelectMode && (
                  <button onPointerDown={(e) => handleDelete(item.id, e)} className="absolute -top-3 -right-3 w-7 h-7 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs shadow-md z-10">✕</button>
                )}
                <div
                  style={{ width: item.width || 256, height: item.height || 256, resize: isLoggedIn && !isSelectMode ? 'both' : 'none', overflow: 'hidden', position: 'relative' }}
                  onPointerDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    if (e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20) {
                      e.stopPropagation();
                    }
                  }}
                  onMouseUp={(e) => handleResizeEnd(item.id, e.currentTarget.offsetWidth, e.currentTarget.offsetHeight)}
                >
                  <img src={item.content} alt="photo" className="w-full h-full object-cover pointer-events-none" />
                </div>
              </motion.div>
            );
          }

          if (item.type === 'text') {
            return (
              <motion.div
                key={item.id}
                className={`absolute text-zinc-700 font-serif group
                  ${isLoggedIn && !isSelectMode && !isPlacing ? 'cursor-grab active:cursor-grabbing' : ''}
                  ${isSelected ? 'ring-4 ring-blue-500 ring-offset-2 z-[60] bg-white rounded-md' : ''}
                  ${isPlacing ? 'pointer-events-none opacity-50' : ''}
                `}
                style={{ left: item.x, top: item.y }}
                onPointerDown={(e) => startDragItem(item.id, item.x, item.y, e)}
                onPointerMove={doDragItem}
                onPointerUp={stopDragItem}
                onPointerCancel={stopDragItem}
                onClick={(e) => handleItemClick(item.id, e)}
              >
                {isLoggedIn && !isSelectMode && (
                  <button onPointerDown={(e) => handleDelete(item.id, e)} className="absolute -top-4 -right-4 w-6 h-6 bg-zinc-200 text-zinc-600 hover:bg-red-500 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs shadow-sm z-[70]">✕</button>
                )}
                
                <div
                  style={{
                    width: item.width || 200, height: item.height || 50, 
                    resize: isLoggedIn && !isSelectMode ? 'both' : 'none', 
                    overflow: 'hidden', position: 'relative', padding: '8px', 
                    minWidth: '50px', minHeight: '40px'
                  }}
                  onPointerDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    if (e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20) e.stopPropagation(); 
                  }}
                  onMouseUp={(e) => handleResizeEnd(item.id, e.currentTarget.offsetWidth, e.currentTarget.offsetHeight)}
                >
                  <textarea
                    value={item.content}
                    onChange={(e) => updateText(item.id, e.target.value)}
                    disabled={!isLoggedIn || isSelectMode || isPlacing} 
                    className={`w-full h-full bg-transparent outline-none resize-none font-bold text-zinc-800 ${isLoggedIn && !isSelectMode ? 'border border-dashed border-transparent hover:border-zinc-300 focus:border-zinc-400' : ''}`}
                    placeholder="输入..."
                    style={{ fontSize: `${(item.width || 200) * 0.1}px`, lineHeight: 1.2 }}
                  />
                </div>
              </motion.div>
            );
          }
        })}
      </motion.div>

      {fullscreenPhoto && (
        <div className="fixed inset-0 z-[100000] bg-black/90 flex flex-col items-center justify-center cursor-zoom-out backdrop-blur-md" onClick={() => setFullscreenPhoto(null)}>
          <img src={fullscreenPhoto} alt="Fullscreen view" className="max-w-[95vw] max-h-[90vh] object-contain drop-shadow-2xl rounded-sm" />
          <p className="text-white/40 text-sm mt-6 font-light tracking-wide pointer-events-none">点击任意空白处返回</p>
        </div>
      )}

      {/* --- 右下角馆长钥匙 & 时光机入口 --- */}
      <div className="absolute bottom-6 right-6 z-[9999] flex items-center gap-3">
        {isLoggedIn ? (
          <>
            <div className="relative">
              <button onClick={() => setShowBackups(!showBackups)} className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow-lg font-medium text-sm flex items-center gap-2">
                💾 时光机
              </button>
              
              {/* 时光机抽屉 */}
              {showBackups && (
                <div className="absolute bottom-12 right-0 w-72 bg-white/95 backdrop-blur-xl border border-zinc-200 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden">
                  <div className="p-3 border-b border-zinc-100 bg-zinc-50 flex justify-between items-center">
                    <span className="font-bold text-zinc-800 text-sm">宇宙快照库 ({backups.length})</span>
                    <button onClick={createBackup} className="text-xs bg-black text-white px-2 py-1 rounded hover:scale-105 transition-transform">+ 存盘</button>
                  </div>
                  <div className="max-h-64 overflow-y-auto p-2 flex flex-col gap-2">
                    {backups.length === 0 && <p className="text-xs text-center text-zinc-400 py-4">暂无存档</p>}
                    {backups.map(b => (
                      <div key={b.id} className="flex flex-col bg-zinc-50 border border-zinc-100 p-2 rounded-lg hover:border-blue-300 transition-colors group cursor-pointer" onClick={() => restoreBackup(b.id)}>
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-sm text-zinc-700 truncate mr-2">{b.name}</span>
                          <button onClick={(e) => deleteBackup(b.id, e)} className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">删除</button>
                        </div>
                        <span className="text-[10px] text-zinc-400 mt-1">{new Date(b.created_at).toLocaleString()} | {b.data.length} 个元素</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button onClick={handleLogout} className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg shadow-lg font-medium text-sm">🔒 锁门</button>
          </>
        ) : (
          <button onClick={() => setShowLogin(!showLogin)} className="text-3xl opacity-30 hover:opacity-100 cursor-pointer transform hover:scale-110">🔑</button>
        )}
      </div>

      {showLogin && !isLoggedIn && (
         <div className="absolute bottom-20 right-6 bg-white/90 backdrop-blur-md p-5 rounded-2xl z-[9999] flex flex-col gap-3 shadow-[0_20px_50px_rgba(0,0,0,0.1)] w-64">
           <p className="font-extrabold text-lg text-zinc-800">馆长通道</p>
           <input placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} className="px-3 py-2 rounded-lg bg-black/5 outline-none font-mono text-sm" />
           <input placeholder="密码" type="password" value={password} onChange={e => setPassword(e.target.value)} className="px-3 py-2 rounded-lg bg-black/5 outline-none text-sm" />
           <button onClick={handleLogin} className="mt-2 py-2 bg-zinc-900 text-white font-medium rounded-lg hover:bg-zinc-800">潜入画廊</button>
         </div>
      )}
    </main>
  );
}
'use client';
import { useState, useRef, useEffect } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';

// 获取真实地址或伪装地址
const supabaseUrl = typeof window !== "undefined" ? `${window.location.origin}/api/supabase` : process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

type CanvasItem = {
  id: string;
  type: 'photo' | 'text';
  content: string;
  x: number;
  y: number;
  width?: number;  
  height?: number; 
};

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 🌟 [新增防崩溃] 判断是否在客户端渲染
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [items, setItems] = useState<CanvasItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSize, setUploadSize] = useState(256);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [scale, setScale] = useState(1);
  const panX = useMotionValue(0);
  const panY = useMotionValue(0);

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isPlacing, setIsPlacing] = useState(false);
  const [placeMode, setPlaceMode] = useState<'selected' | 'all' | null>(null);

  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setIsLoggedIn(!!session));
    supabase.auth.onAuthStateChange((_event, session) => setIsLoggedIn(!!session));
    fetchItems();
  }, []);

  const fetchItems = async () => {
    const { data } = await supabase.from('canvas_items').select('*');
    if (data) setItems(data.map(item => ({
      id: item.id, type: item.item_type, content: item.content,
      x: item.pos_x, y: item.pos_y, width: item.width, height: item.height 
    })));
  };

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) { alert("画廊修改权限已解锁！"); setShowLogin(false); }
    else { alert("邮箱或密码错误！"); }
  };
  
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsSelectMode(false);
    setSelectedIds([]);
    setIsPlacing(false);
    setPlaceMode(null);
    alert("已锁定画廊，现在是公共浏览模式。");
  };

  const getCanvasPos = (screenX: number, screenY: number) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    return {
      x: cx + (screenX - cx - panX.get()) / scale,
      y: cy + (screenY - cy - panY.get()) / scale
    };
  };

  const handleWheel = (e: React.WheelEvent) => {
    // 🌟 [新增防跳动] 在手机端缩放时禁用原生的鼠标滚轮滑动
    if(e.ctrlKey) return; 
    panX.set(panX.get() - e.deltaX);
    panY.set(panY.get() - e.deltaY);
  };

  const handleDoubleClick = async (e: React.MouseEvent | React.TouchEvent) => {
    if (!isLoggedIn || isPlacing) return; 
    if ((e.target as HTMLElement).id === 'canvas-handle') {
      let clientX, clientY;
      // 🌟 [手机触摸判断]
      if ('touches' in e) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = (e as React.MouseEvent).clientX;
        clientY = (e as React.MouseEvent).clientY;
      }

      const { x: startX, y: startY } = getCanvasPos(clientX - 60, clientY - 15);
      const content = '✍️ 点击修改';
      const defaultWidth = 200;
      const defaultHeight = 50;
      const tempId = Date.now().toString();

      setItems(prev => [...prev, { id: tempId, type: 'text', content, x: startX, y: startY, width: defaultWidth, height: defaultHeight }]);
      const { data } = await supabase.from('canvas_items').insert({
        item_type: 'text', content, pos_x: startX, pos_y: startY, width: defaultWidth, height: defaultHeight
      }).select().single();

      if (data) setItems(prev => prev.map(item => item.id === tempId ? { ...item, id: data.id } : item));
    }
  };

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
      const offsetX = i * 40;
      const offsetY = i * 40;
      const { x: startX, y: startY } = getCanvasPos(
        window.innerWidth / 2 - uploadSize / 2 + offsetX, 
        window.innerHeight / 2 - uploadSize / 2 + offsetY
      );

      const { data } = await supabase.from('canvas_items').insert({
        item_type: 'photo', content: photoUrl, pos_x: startX, pos_y: startY, width: uploadSize, height: uploadSize
      }).select().single();

      if (data) {
        newCanvasItems.push({ 
          id: data.id, type: data.item_type, content: data.content, 
          x: data.pos_x, y: data.pos_y, width: data.width, height: data.height 
        });
      }
    }

    if (newCanvasItems.length > 0) setItems(prev => [...prev, ...newCanvasItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsUploading(false);
  };

  const handleDelete = async (id: string, e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setItems(prev => prev.filter(item => item.id !== id));
    await supabase.from('canvas_items').delete().eq('id', id);
  };

  const handleDragEnd = async (id: string, currentX: number, currentY: number, dragInfo: any) => {
    const newX = currentX + dragInfo.offset.x / scale;
    const newY = currentY + dragInfo.offset.y / scale;
    setItems(prev => prev.map(item => item.id === id ? { ...item, x: newX, y: newY } : item));
    await supabase.from('canvas_items').update({ pos_x: newX, pos_y: newY }).eq('id', id);
  };

  const handleResizeEnd = async (id: string, newWidth: number, newHeight: number) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, width: newWidth, height: newHeight } : item));
    await supabase.from('canvas_items').update({ width: newWidth, height: newHeight }).eq('id', id);
  };

  const updateText = async (id: string, newContent: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, content: newContent } : item));
    await supabase.from('canvas_items').update({ content: newContent }).eq('id', id);
  };

  const prepareReArrange = (mode: 'selected' | 'all') => {
    setPlaceMode(mode);
    setIsPlacing(true);
  };

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
      if (index > 0 && index % cols === 0) {
        curX = 0; 
        curY += rowMaxH + gap;
        rowMaxH = 0;
      }
      layoutMap.push({ id: item.id, x: curX, y: curY });
      
      const iw = item.width || 256;
      const ih = item.height || 256;
      curX += iw + gap;
      rowMaxH = Math.max(rowMaxH, ih);
      
      maxOffsetX = Math.max(maxOffsetX, curX - gap);
      maxOffsetY = Math.max(maxOffsetY, curY + ih);
    });

    const startX = targetCenterX - (maxOffsetX / 2);
    const startY = targetCenterY - (maxOffsetY / 2);

    const newItems = [...items];
    const updates: any[] = [];

    layoutMap.forEach((pos) => {
      const fX = startX + pos.x;
      const fY = startY + pos.y;

      const vIndex = newItems.findIndex(i => i.id === pos.id);
      newItems[vIndex] = { ...newItems[vIndex], x: fX, y: fY };
      updates.push({ id: pos.id, pos_x: fX, pos_y: fY });
    });

    setItems(newItems);
    setIsPlacing(false);
    setPlaceMode(null);
    setIsSelectMode(false);
    setSelectedIds([]);

    await Promise.all(updates.map(u => 
      supabase.from('canvas_items').update({ pos_x: u.pos_x, pos_y: u.pos_y }).eq('id', u.id)
    ));
  };

  const handleItemClick = (id: string, e: React.MouseEvent | React.TouchEvent) => {
    if (!isSelectMode || isPlacing) return;
    e.stopPropagation();
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  // 如果客户端没准备好，先不渲染 (防止水合崩溃导致手机白屏)
  if (!mounted) return null;

  return (
    <main 
      className={`relative w-screen h-screen overflow-hidden bg-[#f4f4f2] ${isPlacing ? 'cursor-crosshair' : 'touch-none'}`}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onTouchStart={(e) => {
        // 防止手机端双击和拖拽时触发原生的页面放大缩放
        if(e.touches.length > 1) e.preventDefault(); 
      }}
    >
      <input type="file" accept="image/*" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {/* --- 顶部控制台 (手机端自适应折叠布局) --- */}
      <div className="absolute top-6 left-4 md:left-6 z-50 flex flex-col items-start gap-4 pointer-events-none w-[90vw] md:w-auto">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-zinc-800 tracking-tighter">My Canvas.</h1>
          <p className="text-xs md:text-sm text-zinc-500 mt-1 drop-shadow-sm font-medium hidden md:block">
            {isLoggedIn ? "拖拽排版 / 双击图片放大 / 双击空地加字" : "双击图片全屏放大 / 按住屏幕空地拖拽、用滚轮漫游"}
          </p>
          <p className="text-xs text-zinc-500 mt-1 drop-shadow-sm font-medium md:hidden">
            {isLoggedIn ? "拖拽排版 / 游客模式请锁定" : "双击全屏查看 / 拖拽浏览"}
          </p>
        </div>
        
        {isLoggedIn && (
          <div className="flex flex-wrap items-center gap-2 md:gap-3 pointer-events-auto bg-white/90 p-2 rounded-2xl shadow-sm backdrop-blur-md border border-white/50 w-full md:w-auto max-w-[90vw] overflow-hidden">
            {isPlacing ? (
              <div className="flex items-center justify-between w-full md:w-auto px-2 py-2 text-xs md:text-sm rounded-xl font-bold bg-yellow-400 text-black shadow-lg animate-bounce border border-yellow-500">
                <span className="truncate flex-1">
                  👇 请点空地选定中心
                </span>
                <button onClick={() => { setIsPlacing(false); setPlaceMode(null); }} className="px-2 py-1 bg-black/10 hover:bg-black/20 rounded-md transition-colors whitespace-nowrap ml-2">
                  取消
                </button>
              </div>
            ) : (
              <>
                <button onClick={() => { setIsSelectMode(!isSelectMode); setSelectedIds([]); }}
                  className={`px-3 py-1.5 md:py-2 text-xs md:text-sm rounded-xl font-bold transition-all shadow-sm whitespace-nowrap ${isSelectMode ? 'bg-blue-100 text-blue-600 border border-blue-300' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}>
                  {isSelectMode ? "退出" : "🔲多选"}
                </button>

                {!isSelectMode && (
                  <button onClick={() => prepareReArrange('all')} className="px-3 py-1.5 md:py-2 text-xs md:text-sm rounded-xl font-bold transition-all bg-purple-600 text-white hover:bg-purple-500 shadow-sm whitespace-nowrap">
                    🌌全图({items.filter(i => i.type==='photo').length})
                  </button>
                )}

                {isSelectMode && selectedIds.length > 0 && (
                  <button onClick={() => prepareReArrange('selected')} className="px-3 py-1.5 md:py-2 text-xs md:text-sm rounded-xl font-bold transition-all bg-blue-600 text-white hover:bg-blue-500 shadow-lg animate-pulse whitespace-nowrap">
                    整理({selectedIds.length}项)
                  </button>
                )}

                {!isSelectMode && (
                  <div className="flex items-center gap-2 border-t md:border-t-0 md:border-l border-zinc-200 pt-2 md:pt-0 mt-1 md:mt-0 pl-0 md:pl-2 w-full md:w-auto">
                    <select value={uploadSize} onChange={(e) => setUploadSize(Number(e.target.value))} className="bg-transparent text-sm font-bold outline-none cursor-pointer">
                      <option value={150}>小图</option>
                      <option value={256}>中图</option>
                      <option value={400}>大图</option>
                      <option value={600}>超大</option>
                    </select>
                    <button onClick={() => fileInputRef.current?.click()} disabled={isUploading || isPlacing} className={`flex-1 px-4 py-1.5 md:py-2 text-xs md:text-sm rounded-xl shadow-lg transition-all text-white whitespace-nowrap ${isUploading ? 'bg-zinc-400' : 'bg-zinc-900 hover:scale-105'}`}>
                      {isUploading ? "传送中" : "+ 上传"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="absolute bottom-6 left-4 md:left-6 z-50 flex items-center bg-white/90 backdrop-blur-md shadow-lg rounded-full px-3 py-2 border border-black/5 gap-3">
        <button onClick={() => setScale(s => Math.max(0.1, s / 1.2))} className="text-xl px-2 text-zinc-600 active:scale-95">−</button>
        <button onClick={() => { setScale(1); panX.set(0); panY.set(0); }} className="text-xs font-bold w-10 text-center text-zinc-700 active:scale-95">
          {Math.round(scale * 100)}%
        </button>
        <button onClick={() => setScale(s => Math.min(5, s * 1.2))} className="text-xl px-2 text-zinc-600 active:scale-95">+</button>
      </div>

      <motion.div
        className="absolute top-0 left-0 w-screen h-screen"
        style={{ x: panX, y: panY, scale }}
        drag={!isPlacing} 
        dragMomentum={true}
      >
        <div 
          id="canvas-handle"
          className="absolute w-[1000vw] h-[1000vh] -left-[450vw] -top-[450vh] active:cursor-grabbing"
          style={{ backgroundImage: 'radial-gradient(#d4d4d8 1.5px, transparent 1.5px)', backgroundSize: `48px 48px` }}
          onClick={(e) => {
            if (isPlacing) {
              const { x, y } = getCanvasPos(e.clientX, e.clientY);
              executeArrange(x, y);
            }
          }}
          onTouchEnd={(e) => {
            // 手机端在放置模式下点按
            if (isPlacing && e.changedTouches.length > 0) {
              const { x, y } = getCanvasPos(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
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
                className={`absolute top-0 left-0 shadow-lg p-1.5 md:p-2 bg-white pb-6 md:pb-8 group transition-all duration-300
                  ${isLoggedIn && !isSelectMode && !isPlacing ? 'cursor-grab active:cursor-grabbing' : ''}
                  ${isSelected ? 'ring-4 ring-blue-500 ring-offset-2 z-[60] scale-105' : ''}
                  ${isPlacing ? 'pointer-events-none opacity-50' : ''} 
                `}
                style={{ x: item.x, y: item.y }}
                drag={isLoggedIn && !isSelectMode && !isPlacing}
                onClick={(e) => handleItemClick(item.id, e)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isSelectMode && !isPlacing) setFullscreenPhoto(item.content);
                }}
                dragMomentum={false} 
                onDragEnd={(e, info) => handleDragEnd(item.id, item.x, item.y, info)}
                whileHover={isLoggedIn && !isSelectMode && !isPlacing ? { scale: 1.02 } : {}} 
                whileTap={isLoggedIn && !isSelectMode && !isPlacing ? { zIndex: 50, scale: 1.02 } : {}} 
              >
                {isLoggedIn && !isSelectMode && (
                  <button onPointerDown={(e) => handleDelete(item.id, e)} className="absolute -top-2 -right-2 md:-top-3 md:-right-3 w-6 h-6 md:w-7 md:h-7 bg-red-500 text-white rounded-full opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs shadow-md z-[70]">✕</button>
                )}
                <div
                  style={{ width: item.width || 200, height: item.height || 200, resize: isLoggedIn && !isSelectMode ? 'both' : 'none', overflow: 'hidden', position: 'relative' }}
                  onPointerDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    // 扩大手机里用于改变大小的触控区到 30px
                    if (e.clientX > rect.right - 30 && e.clientY > rect.bottom - 30) e.stopPropagation(); 
                  }}
                  onMouseUp={(e) => handleResizeEnd(item.id, e.currentTarget.offsetWidth, e.currentTarget.offsetHeight)}
                  onTouchEnd={(e) => handleResizeEnd(item.id, e.currentTarget.offsetWidth, e.currentTarget.offsetHeight)}
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
                className={`absolute top-0 left-0 text-zinc-700 font-serif text-xl group transition-all duration-300
                  ${isLoggedIn && !isSelectMode && !isPlacing ? 'cursor-grab active:cursor-grabbing' : ''}
                  ${isSelected ? 'ring-4 ring-blue-500 ring-offset-2 z-[60] bg-white rounded-md scale-105' : ''}
                  ${isPlacing ? 'pointer-events-none opacity-50' : ''}
                `}
                style={{ x: item.x, y: item.y }}
                drag={isLoggedIn && !isSelectMode && !isPlacing}
                onClick={(e) => handleItemClick(item.id, e)}
                dragMomentum={false}
                onDragEnd={(e, info) => handleDragEnd(item.id, item.x, item.y, info)}
                whileTap={isLoggedIn && !isSelectMode && !isPlacing ? { zIndex: 50, scale: 1.02 } : {}}
              >
                {isLoggedIn && !isSelectMode && (
                  <button onPointerDown={(e) => handleDelete(item.id, e)} className="absolute -top-3 -right-3 w-6 h-6 bg-zinc-200 md:bg-red-500 text-zinc-600 md:text-white rounded-full opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs shadow-sm z-[70]">✕</button>
                )}
                
                <div
                  style={{
                    width: item.width || 150, height: item.height || 40, resize: isLoggedIn && !isSelectMode ? 'both' : 'none', overflow: 'hidden', position: 'relative', padding: '4px md:8px', minWidth: '50px', minHeight: '30px'
                  }}
                  onPointerDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    if (e.clientX > rect.right - 30 && e.clientY > rect.bottom - 30) e.stopPropagation(); 
                  }}
                  onMouseUp={(e) => handleResizeEnd(item.id, e.currentTarget.offsetWidth, e.currentTarget.offsetHeight)}
                  onTouchEnd={(e) => handleResizeEnd(item.id, e.currentTarget.offsetWidth, e.currentTarget.offsetHeight)}
                >
                  <textarea
                    value={item.content}
                    onChange={(e) => updateText(item.id, e.target.value)}
                    disabled={!isLoggedIn || isSelectMode || isPlacing} 
                    className={`w-full h-full bg-transparent outline-none resize-none font-bold text-zinc-800 ${isLoggedIn && !isSelectMode ? 'border border-dashed border-zinc-300 md:border-transparent focus:border-zinc-400' : ''}`}
                    placeholder="输入..."
                    style={{ fontSize: `${(item.width || 150) * 0.12}px`, lineHeight: 1.2 }}
                  />
                </div>
              </motion.div>
            );
          }
        })}
      </motion.div>

      {/* 🌟 手机端双击查看原图优化：兼容触摸，加入模糊背板 */}
      {fullscreenPhoto && (
        <div 
          className="fixed inset-0 z-[100000] bg-black/95 flex flex-col items-center justify-center backdrop-blur-xl transition-all p-4"
          onClick={() => setFullscreenPhoto(null)} 
        >
          <img 
            src={fullscreenPhoto} 
            alt="Fullscreen" 
            className="w-auto h-auto max-w-full max-h-full object-contain shadow-2xl rounded-md"
          />
          <p className="absolute bottom-10 text-white/50 text-xs md:text-sm tracking-widest pointer-events-none bg-black/40 px-4 py-2 rounded-full">触碰任意区域返回</p>
        </div>
      )}

      <div className="absolute bottom-6 right-4 md:right-6 z-[9999]">
        {isLoggedIn ? (
          <button onClick={handleLogout} className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg shadow-lg font-medium text-xs md:text-sm">🔒 锁门</button>
        ) : (
          <button onClick={() => setShowLogin(!showLogin)} className="text-2xl md:text-3xl opacity-30 hover:opacity-100 cursor-pointer p-2 -mr-2">🔑</button>
        )}
      </div>

      {showLogin && !isLoggedIn && (
         <div className="absolute bottom-20 right-4 md:right-6 bg-white/95 backdrop-blur-xl p-4 md:p-5 rounded-2xl z-[9999] flex flex-col gap-3 shadow-2xl w-[90vw] md:w-64 max-w-[300px]">
           <p className="font-extrabold text-base md:text-lg text-zinc-800">馆长通道</p>
           <input placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} className="px-3 py-2 rounded-lg bg-black/5 outline-none text-sm" />
           <input placeholder="密码" type="password" value={password} onChange={e => setPassword(e.target.value)} className="px-3 py-2 rounded-lg bg-black/5 outline-none text-sm" />
           <button onClick={handleLogin} className="mt-2 py-2 bg-zinc-900 text-white font-medium rounded-lg active:scale-95 text-sm">潜入画廊</button>
         </div>
      )}
    </main>
  );
}
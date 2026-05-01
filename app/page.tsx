'use client';
import { useState, useRef, useEffect } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';

// 初始化 Supabase 客户端
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
  
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSize, setUploadSize] = useState(256);

  // 🎟️ 馆长与登录状态
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 🔍 相机控制状态 (无限画布核心)
  const [scale, setScale] = useState(1);
  const panX = useMotionValue(0);
  const panY = useMotionValue(0);

  // 🕵️ 检查登录
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
  };
  
  const handleLogout = async () => {
    await supabase.auth.signOut();
    alert("已锁定画廊，现在是公共浏览模式。");
  };

  // 🧮 坐标轴魔法转换器：把屏幕点击的坐标，转换进被缩放/平移过的真实画布里
  const getCanvasPos = (screenX: number, screenY: number) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    return {
      x: cx + (screenX - cx - panX.get()) / scale,
      y: cy + (screenY - cy - panY.get()) / scale
    };
  };

  // 鼠标滚轮/触摸板：平移画布 (阻断原生滚动)
  const handleWheel = (e: React.WheelEvent) => {
    panX.set(panX.get() - e.deltaX);
    panY.set(panY.get() - e.deltaY);
  };

  const handleDoubleClick = async (e: React.MouseEvent) => {
    if (!isLoggedIn) return; 
    // 只有双击到背景点阵图才触发
    if ((e.target as HTMLElement).id === 'canvas-handle') {
      const { x: startX, y: startY } = getCanvasPos(e.clientX - 60, e.clientY - 15);
      const content = '✍️ 点击修改';
      const tempId = Date.now().toString();

      setItems(prev => [...prev, { id: tempId, type: 'text', content, x: startX, y: startY }]);
      const { data } = await supabase.from('canvas_items').insert({
        item_type: 'text', content, pos_x: startX, pos_y: startY
      }).select().single();

      if (data) setItems(prev => prev.map(item => item.id === tempId ? { ...item, id: data.id } : item));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const fileName = `${Date.now()}.${file.name.split('.').pop()}`; 
    const { error: uploadError } = await supabase.storage.from('photos').upload(fileName, file);

    if (uploadError) { alert("上传失败：" + uploadError.message); setIsUploading(false); return; }

    const photoUrl = supabase.storage.from('photos').getPublicUrl(fileName).data.publicUrl;

    // 精准落在屏幕正中央 (无论怎么缩放平移)
    const { x: startX, y: startY } = getCanvasPos(window.innerWidth / 2 - uploadSize / 2, window.innerHeight / 2 - uploadSize / 2);

    const { data } = await supabase.from('canvas_items').insert({
      item_type: 'photo', content: photoUrl, pos_x: startX, pos_y: startY, width: uploadSize, height: uploadSize
    }).select().single();

    if (data) {
      setItems(prev => [...prev, { id: data.id, type: data.item_type, content: data.content, x: data.pos_x, y: data.pos_y, width: data.width, height: data.height }]);
    }
    setIsUploading(false);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setItems(prev => prev.filter(item => item.id !== id));
    await supabase.from('canvas_items').delete().eq('id', id);
  };

  const handleDragEnd = async (id: string, currentX: number, currentY: number, dragInfo: any) => {
    // 核心修复：拖拽距离必须除以缩放比例，否则在缩放状态下拖东西会“漂移”
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

  return (
    <main 
      className="relative w-screen h-screen overflow-hidden bg-[#f4f4f2]"
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
    >
      <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {/* --- 顶部馆长控制台 (固定在屏幕上，不随画布移动) --- */}
      <div className="absolute top-6 left-6 z-50 flex flex-col items-start gap-4 pointer-events-none">
        <div>
          <h1 className="text-3xl font-bold text-zinc-800 tracking-tighter">My Canvas.</h1>
          <p className="text-sm text-zinc-500 mt-1 drop-shadow-sm font-medium">
            {isLoggedIn ? "拖拽排版 / 右下缩放 / 双击空白加文字" : "游客体验模式 (按住屏幕空地拖拽、用滚轮漫游)"}
          </p>
        </div>
        
        {isLoggedIn && (
          <div className="flex items-center gap-3 pointer-events-auto bg-white/90 p-2 rounded-2xl shadow-sm backdrop-blur-md border border-white/50">
            <div className="flex items-center gap-2 text-sm text-zinc-600 pl-2">
              <span>大小：</span>
              <select value={uploadSize} onChange={(e) => setUploadSize(Number(e.target.value))} className="bg-transparent font-bold outline-none cursor-pointer">
                <option value={150}>小图 (150px)</option>
                <option value={256}>中图 (256px)</option>
                <option value={400}>大图 (400px)</option>
                <option value={600}>超大图 (600px)</option>
              </select>
            </div>
            <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className={`px-4 py-2 text-sm rounded-full shadow-lg transition-all text-white ${isUploading ? 'bg-zinc-400' : 'bg-zinc-900 hover:scale-105'}`}>
              {isUploading ? "📸 飞升中..." : "+ 上传图画"}
            </button>
          </div>
        )}
      </div>

      {/* --- 左下角缩放控制器 --- */}
      <div className="absolute bottom-6 left-6 z-50 flex items-center bg-white/90 backdrop-blur-md shadow-lg rounded-full px-4 py-2 border border-black/5 gap-4 shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
        <button onClick={() => setScale(s => Math.max(0.1, s / 1.2))} className="text-xl px-2 hover:scale-125 transition-transform text-zinc-600">−</button>
        <button onClick={() => { setScale(1); panX.set(0); panY.set(0); }} className="text-xs font-bold w-12 text-center text-zinc-700 hover:text-black">
          {Math.round(scale * 100)}%
        </button>
        <button onClick={() => setScale(s => Math.min(5, s * 1.2))} className="text-xl px-2 hover:scale-125 transition-transform text-zinc-600">+</button>
      </div>

      {/* --- 🌍 本质：无限画布相机世界 --- */}
      <motion.div
        className="absolute top-0 left-0 w-screen h-screen"
        style={{ x: panX, y: panY, scale }}
        drag
        dragMomentum={true}
      >
        {/* 1. 巨大且透明的“平移把手”，铺满全宇宙并自带网点 */}
        <div 
          id="canvas-handle"
          className="absolute w-[1000vw] h-[1000vh] -left-[450vw] -top-[450vh] cursor-grab active:cursor-grabbing"
          style={{
            backgroundImage: 'radial-gradient(#d4d4d8 1.5px, transparent 1.5px)',
            backgroundSize: `48px 48px`,
            backgroundPosition: 'center center'
          }}
        />

        {/* 2. 画布里的实体元素 */}
        {items.map((item) => {
          if (item.type === 'photo') {
            return (
              <motion.div
                key={item.id}
                className={`absolute top-0 left-0 shadow-lg p-2 bg-white pb-8 group ${isLoggedIn ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={{ x: item.x, y: item.y }}
                drag={isLoggedIn}
                dragMomentum={false} 
                onDragEnd={(e, info) => handleDragEnd(item.id, item.x, item.y, info)}
                whileHover={isLoggedIn ? { scale: 1.02 } : {}} 
                whileTap={isLoggedIn ? { zIndex: 50, scale: 1.05 } : {}} 
              >
                {isLoggedIn && (
                  <button onClick={(e) => handleDelete(item.id, e)} className="absolute -top-3 -right-3 w-7 h-7 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs shadow-md z-10">✕</button>
                )}
                <div
                  style={{ width: item.width || 256, height: item.height || 256, resize: isLoggedIn ? 'both' : 'none', overflow: 'hidden', position: 'relative' }}
                  onPointerDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    if (e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20) e.stopPropagation(); 
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
                className={`absolute top-0 left-0 text-zinc-700 font-serif text-xl group px-2 py-1 ${isLoggedIn ? 'cursor-grab active:cursor-grabbing' : ''}`}
                style={{ x: item.x, y: item.y }}
                drag={isLoggedIn}
                dragMomentum={false}
                onDragEnd={(e, info) => handleDragEnd(item.id, item.x, item.y, info)}
                whileTap={isLoggedIn ? { zIndex: 50 } : {}}
              >
                {isLoggedIn && (
                  <button onClick={(e) => handleDelete(item.id, e)} className="absolute -top-4 -right-4 w-6 h-6 bg-zinc-200 text-zinc-600 hover:bg-red-500 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs shadow-sm z-10">✕</button>
                )}
                <input
                  type="text"
                  value={item.content}
                  onChange={(e) => updateText(item.id, e.target.value)}
                  disabled={!isLoggedIn} 
                  className={`bg-transparent outline-none w-auto ${isLoggedIn ? 'border-b border-transparent focus:border-zinc-300' : ''}`}
                  style={{ width: `${Math.max(item.content.length, 4)}ch` }}
                />
              </motion.div>
            );
          }
        })}
      </motion.div>

      {/* --- 右下角馆长钥匙 --- */}
      <div className="absolute bottom-6 right-6 z-[9999]">
        {isLoggedIn ? (
          <button onClick={handleLogout} className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg shadow-lg transition-colors font-medium text-sm">🔒 锁回墙内</button>
        ) : (
          <button onClick={() => setShowLogin(!showLogin)} className="text-3xl opacity-30 hover:opacity-100 drop-shadow-sm transition-opacity cursor-pointer transform hover:scale-110">🔑</button>
        )}
      </div>

      {showLogin && !isLoggedIn && (
        <div className="absolute bottom-20 right-6 bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-white/50 z-[9999] flex flex-col gap-3 shadow-[0_20px_50px_rgba(0,0,0,0.1)] w-64">
          <p className="font-extrabold text-lg text-zinc-800 tracking-tight">馆长通道</p>
          <input placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} className="px-3 py-2 rounded-lg bg-black/5 outline-none focus:ring-2 focus:ring-black/20 transition-all font-mono text-sm" />
          <input placeholder="密码" type="password" value={password} onChange={e => setPassword(e.target.value)} className="px-3 py-2 rounded-lg bg-black/5 outline-none focus:ring-2 focus:ring-black/20 transition-all text-sm" />
          <button onClick={handleLogin} className="mt-2 py-2 bg-zinc-900 text-white font-medium rounded-lg hover:bg-zinc-800 transition-colors shadow-md">潜入画廊</button>
        </div>
      )}
    </main>
  );
}
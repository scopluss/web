'use client';
import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';

// 初始化 Supabase 客户端
const supabaseUrl = "/api/supabase";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// 🆕 1. 在类型中增加 width 和 height 记忆
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
  const containerRef = useRef(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // 🎟️ 馆长专属状态
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 🕵️ 检查登录
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session);
    });
  }, []);

  // 🔑 登录退出
  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      alert("登录失败了，请检查邮箱和密码！");
    } else {
      alert("欢迎回来，馆长！画廊修改权限已解锁！");
      setShowLogin(false);
    }
  };
  const handleLogout = async () => {
    await supabase.auth.signOut();
    alert("已锁定画廊，现在是公共浏览模式。");
  };

  // 获取数据 (🆕2. 提取 width 和 height)
  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    const { data, error } = await supabase.from('canvas_items').select('*');
    if (data) {
      const formattedItems = data.map(item => ({
        id: item.id,
        type: item.item_type,
        content: item.content,
        x: item.pos_x,
        y: item.pos_y,
        width: item.width,   // 提取宽度
        height: item.height  // 提取高度
      }));
      setItems(formattedItems);
    }
  };

  const handleDoubleClick = async (e: React.MouseEvent) => {
    if (!isLoggedIn) return; 
    
    if (e.target === containerRef.current) {
      const startX = e.clientX - 60;
      const startY = e.clientY - 15;
      const content = '✍️ 点击修改';

      const tempId = Date.now().toString();
      setItems(prev => [...prev, { id: tempId, type: 'text', content, x: startX, y: startY }]);

      const { data } = await supabase.from('canvas_items').insert({
        item_type: 'text', content: content, pos_x: startX, pos_y: startY
      }).select().single();

      if (data) setItems(prev => prev.map(item => item.id === tempId ? { ...item, id: data.id } : item));
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`; 
    const { error: uploadError } = await supabase.storage.from('photos').upload(fileName, file);

    if (uploadError) {
      alert("图片上传失败：" + uploadError.message);
      setIsUploading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('photos').getPublicUrl(fileName);
    const photoUrl = publicUrlData.publicUrl;

    const startX = window.innerWidth / 2 - 100;
    const startY = window.innerHeight / 2 - 150;

    // 🆕3. 上传时给定默认的长宽 256
    const { data: dbData, error } = await supabase.from('canvas_items').insert({
      item_type: 'photo', content: photoUrl, pos_x: startX, pos_y: startY, width: 256, height: 256
    }).select().single();

    if (dbData) {
      setItems(prev => [...prev, { 
        id: dbData.id, type: dbData.item_type, content: dbData.content, 
        x: dbData.pos_x, y: dbData.pos_y, width: dbData.width, height: dbData.height 
      }]);
    }
    setIsUploading(false);
  };

  const handleDelete = async (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
    await supabase.from('canvas_items').delete().eq('id', id);
  };

  const handleDragEnd = async (id: string, currentX: number, currentY: number, dragInfo: any) => {
    const newX = currentX + dragInfo.offset.x;
    const newY = currentY + dragInfo.offset.y;
    setItems(prev => prev.map(item => item.id === id ? { ...item, x: newX, y: newY } : item));
    await supabase.from('canvas_items').update({ pos_x: newX, pos_y: newY }).eq('id', id);
  };

  // 🆕4. 缩放结束，更新数据库尺寸的函数
  const handleResizeEnd = async (id: string, newWidth: number, newHeight: number) => {
    // 同步到本地
    setItems(prev => prev.map(item => item.id === id ? { ...item, width: newWidth, height: newHeight } : item));
    // 同步到云端
    await supabase.from('canvas_items').update({ width: newWidth, height: newHeight }).eq('id', id);
  };

  const handleTextBlur = async (id: string, newContent: string) => {
    await supabase.from('canvas_items').update({ content: newContent }).eq('id', id);
  };
  const updateTextLocally = (id: string, newText: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, content: newText } : item));
  };

  return (
    <main 
      className="relative w-screen h-screen overflow-hidden bg-[#f8f8f6]"
      ref={containerRef}
      onDoubleClick={handleDoubleClick}
    >
      <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {/* 顶部控制台 */}
      <div className="absolute top-6 left-6 z-50 flex flex-col items-start gap-4 pointer-events-none">
        <div>
          <h1 className="text-2xl font-bold text-zinc-800 tracking-tighter">My Canvas.</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isLoggedIn ? "拖拽排版 / 右下角缩放 / 双击空白加文字" : "当前为游客参观模式 (只读)"}
          </p>
        </div>
        
        {isLoggedIn && (
          <button 
            onClick={triggerFileInput}
            disabled={isUploading}
            className={`pointer-events-auto px-4 py-2 text-sm rounded-full shadow-lg transition-all text-white
              ${isUploading ? 'bg-zinc-400 cursor-not-allowed' : 'bg-zinc-900 hover:bg-zinc-700 hover:scale-105'}
            `}
          >
            {isUploading ? "📸 照片上传中..." : "+ 上传照片"}
          </button>
        )}
      </div>

      {/* 渲染元素 */}
      {items.map((item) => {
        if (item.type === 'photo') {
          return (
            <motion.div
              key={item.id}
              className={`absolute shadow-lg p-2 bg-white pb-8 group ${isLoggedIn ? 'cursor-grab active:cursor-grabbing' : ''}`}
              style={{ left: item.x, top: item.y }}
              drag={isLoggedIn}
              dragMomentum={false} 
              onDragEnd={(e, info) => handleDragEnd(item.id, item.x, item.y, info)}
              whileHover={isLoggedIn ? { scale: 1.02 } : {}} 
              whileTap={isLoggedIn ? { zIndex: 50, scale: 1.05 } : {}} 
            >
              {isLoggedIn && (
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                  className="absolute -top-3 -right-3 w-7 h-7 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs shadow-md z-10"
                >✕</button>
              )}

              {/* 🆕5. 隐形的调整外壳，里面包裹原图 */}
              <div
                style={{
                  width: item.width || 256,
                  height: item.height || 256,
                  resize: isLoggedIn ? 'both' : 'none', // 登录后开启拖拽条
                  overflow: 'hidden',
                  position: 'relative'
                }}
                // 【核心魔法】防止拖动缩放条时，照片被拖跑
                onPointerDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const isResizeArea = (e.clientX > rect.right - 20) && (e.clientY > rect.bottom - 20);
                  if (isResizeArea) e.stopPropagation(); 
                }}
                // 松开鼠标时保存最新尺寸
                onMouseUp={(e) => {
                  handleResizeEnd(item.id, e.currentTarget.offsetWidth, e.currentTarget.offsetHeight);
                }}
              >
                <img 
                  src={item.content} 
                  alt="canvas photo" 
                  className="w-full h-full object-cover pointer-events-none" 
                />
              </div>
            </motion.div>
          );
        }

        if (item.type === 'text') {
          // ... 文本部分保持原样 ...
          return (
            <motion.div
              key={item.id}
              className={`absolute text-zinc-700 font-serif text-xl group px-2 py-1 ${isLoggedIn ? 'cursor-grab active:cursor-grabbing' : ''}`}
              style={{ left: item.x, top: item.y }}
              drag={isLoggedIn}
              dragMomentum={false}
              onDragEnd={(e, info) => handleDragEnd(item.id, item.x, item.y, info)}
              whileTap={isLoggedIn ? { zIndex: 50 } : {}}
            >
              {isLoggedIn && (
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                  className="absolute -top-4 -right-4 w-6 h-6 bg-zinc-200 text-zinc-600 hover:bg-red-500 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs shadow-sm z-10"
                >✕</button>
              )}

              <input
                type="text"
                value={item.content}
                onChange={(e) => updateTextLocally(item.id, e.target.value)}
                onBlur={(e) => handleTextBlur(item.id, e.target.value)}
                disabled={!isLoggedIn} 
                className={`bg-transparent outline-none w-auto ${isLoggedIn ? 'border-b border-transparent focus:border-zinc-300' : ''}`}
                style={{ width: `${Math.max(item.content.length, 4)}ch` }}
              />
            </motion.div>
          );
        }
      })}

      {/* 门禁体系 */}
      <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999 }}>
        {isLoggedIn ? (
          <button onClick={handleLogout} style={{ padding: '8px', background: '#ff4d4f', color: '#fff', borderRadius: '8px', cursor: 'pointer', border: 'none' }}>
            🔒 锁定展馆
          </button>
        ) : (
          <button onClick={() => setShowLogin(!showLogin)} style={{ background: 'transparent', border: 'none', fontSize: '24px', opacity: 0.3, cursor: 'pointer' }}>
            🔑
          </button>
        )}
      </div>

      {showLogin && !isLoggedIn && (
        <div style={{ position: 'fixed', bottom: '60px', right: '20px', background: '#fff', padding: '15px', borderRadius: '8px', border: '1px s
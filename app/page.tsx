'use client';
import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';

// 初始化 Supabase 客户端
const supabaseUrl = "/api/supabase";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

type CanvasItem = {
  id: string;
  type: 'photo' | 'text';
  content: string;
  x: number;
  y: number;
};

export default function Home() {
  const containerRef = useRef(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // 🎟️ 馆长专属状态 (必须放在组件内部)
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 🕵️ 每次打开网页自动检查是不是馆长本人
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session);
    });
  }, []);

  // 🔑 登录和退出动作
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

  // 1. 网页刚打开时，从数据库拉取所有保存好的画布元素
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
        y: item.pos_y
      }));
      setItems(formattedItems);
    }
  };

  // 2. 双击背景添加文本 (加了隐形斗篷：必须登录才能触发)
  const handleDoubleClick = async (e: React.MouseEvent) => {
    if (!isLoggedIn) return; // 🛡️ 如果没登录，双击没反应
    
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

  // 3. 点击按钮触发本地选择文件
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // 4. 上传图片
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

    const { data: dbData } = await supabase.from('canvas_items').insert({
      item_type: 'photo', content: photoUrl, pos_x: startX, pos_y: startY
    }).select().single();

    if (dbData) {
      setItems(prev => [...prev, { id: dbData.id, type: dbData.item_type, content: dbData.content, x: dbData.pos_x, y: dbData.pos_y }]);
    }
    setIsUploading(false);
  };

  // 5. 删除元素
  const handleDelete = async (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
    await supabase.from('canvas_items').delete().eq('id', id);
  };

  // 6. 拖拽停止更新
  const handleDragEnd = async (id: string, currentX: number, currentY: number, dragInfo: any) => {
    const newX = currentX + dragInfo.offset.x;
    const newY = currentY + dragInfo.offset.y;
    setItems(prev => prev.map(item => item.id === id ? { ...item, x: newX, y: newY } : item));
    await supabase.from('canvas_items').update({ pos_x: newX, pos_y: newY }).eq('id', id);
  };

  // 7. 更新文字
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
            {isLoggedIn ? "拖拽排版 / 双击空白加文字 / 刷新保留" : "当前为游客参观模式 (只读)"}
          </p>
        </div>
        
        {/* 🛡️ 隐形斗篷：只有登录才显示上传按钮 */}
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
              drag={isLoggedIn} // 🛡️ 只有登录才能拖拽
              dragMomentum={false} 
              onDragEnd={(e, info) => handleDragEnd(item.id, item.x, item.y, info)}
              whileHover={isLoggedIn ? { scale: 1.02 } : {}} 
              whileTap={isLoggedIn ? { zIndex: 50, scale: 1.05 } : {}} 
            >
              {/* 🛡️ 只有登录才显示删除按钮 */}
              {isLoggedIn && (
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                  className="absolute -top-3 -right-3 w-7 h-7 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs shadow-md z-10"
                >✕</button>
              )}
              <img src={item.content} alt="canvas photo" className="w-64 h-auto object-cover pointer-events-none" />
            </motion.div>
          );
        }

        if (item.type === 'text') {
          return (
            <motion.div
              key={item.id}
              className={`absolute text-zinc-700 font-serif text-xl group px-2 py-1 ${isLoggedIn ? 'cursor-grab active:cursor-grabbing' : ''}`}
              style={{ left: item.x, top: item.y }}
              drag={isLoggedIn} // 🛡️ 只有登录才能拖拽
              dragMomentum={false}
              onDragEnd={(e, info) => handleDragEnd(item.id, item.x, item.y, info)}
              whileTap={isLoggedIn ? { zIndex: 50 } : {}}
            >
              {/* 🛡️ 只有登录才显示删除按钮 */}
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
                disabled={!isLoggedIn} // 🛡️ 没登录不能修改文字内容
                className={`bg-transparent outline-none w-auto ${isLoggedIn ? 'border-b border-transparent focus:border-zinc-300' : ''}`}
                style={{ width: `${Math.max(item.content.length, 4)}ch` }}
              />
            </motion.div>
          );
        }
      })}

      {/* 🛡️ 右下角隐形小门禁 ---------------- */}
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
        <div style={{ position: 'fixed', bottom: '60px', right: '20px', background: '#fff', padding: '15px', borderRadius: '8px', border: '1px solid #ddd', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <p style={{ margin: 0, fontWeight: 'bold' }}>馆长通道</p>
          <input placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
          <input placeholder="密码" type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
          <button onClick={handleLogin} style={{ padding: '8px', background: '#000', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            开启修改模式
          </button>
        </div>
      )}
    </main>
  );
}
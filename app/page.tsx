'use client';
import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';

// 初始化 Supabase 客户端 (自动读取 .env.local 里的密码)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
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

  // 1. 网页刚打开时，从数据库拉取所有保存好的画布元素
  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    const { data, error } = await supabase.from('canvas_items').select('*');
    if (data) {
      // 把数据库的字段格式化为前端认识的格式
      const formattedItems = data.map(item => ({
        id: item.id,
        type: item.item_type,
        content: item.content,
        x: item.pos_x,
        y: item.pos_y
      }));
      setItems(formattedItems);
    }
    if (error) console.error("读取失败:", error);
  };

  // 2. 双击背景添加文本 (并存入数据库)
  const handleDoubleClick = async (e: React.MouseEvent) => {
    if (e.target === containerRef.current) {
      const startX = e.clientX - 60;
      const startY = e.clientY - 15;
      const content = '✍️ 点击修改';

      // 乐观更新：先在屏幕上显示出来，体验更流畅
      const tempId = Date.now().toString();
      setItems(prev => [...prev, { id: tempId, type: 'text', content, x: startX, y: startY }]);

      // 真正存入数据库
      const { data, error } = await supabase.from('canvas_items').insert({
        item_type: 'text',
        content: content,
        pos_x: startX,
        pos_y: startY
      }).select().single();

      // 存入成功后，把临时 ID 替换为数据库真实的 UUID
      if (data) {
        setItems(prev => prev.map(item => item.id === tempId ? { ...item, id: data.id } : item));
      }
    }
  };

  // 3. 点击按钮触发本地选择文件
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // 4. 选择本地图片后，真实上传到 Supabase Storage，并写库
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true); // 显示正在上传的状态

    // (1) 上传图片到 Storage (桶名 photos)
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`; // 用时间戳起个不重名的名字
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('photos')
      .upload(fileName, file);

    if (uploadError) {
      alert("图片上传失败：" + uploadError.message);
      setIsUploading(false);
      return;
    }

    // (2) 获取公开可访问的图片 URL
    const { data: publicUrlData } = supabase.storage.from('photos').getPublicUrl(fileName);
    const photoUrl = publicUrlData.publicUrl;

    // (3) 把新图片的网址和坐标 (默认在屏幕中间) 存入数据库
    const startX = window.innerWidth / 2 - 100;
    const startY = window.innerHeight / 2 - 150;

    const { data: dbData, error: dbError } = await supabase.from('canvas_items').insert({
      item_type: 'photo',
      content: photoUrl,
      pos_x: startX,
      pos_y: startY
    }).select().single();

    if (dbData) {
      // 成功后，加入到画面上
      setItems(prev => [...prev, {
        id: dbData.id, type: dbData.item_type, content: dbData.content, x: dbData.pos_x, y: dbData.pos_y
      }]);
    }
    setIsUploading(false); // 结束上传状态
  };

  // 5. 删除元素 (前端删除 + 数据库真实删除)
  const handleDelete = async (id: string) => {
    // 乐观更新：先从画面移除
    setItems(prev => prev.filter(item => item.id !== id));
    // 后台删库
    await supabase.from('canvas_items').delete().eq('id', id);
  };

  // 6. 拖拽停止时，更新数据库里的新坐标！
  const handleDragEnd = async (id: string, currentX: number, currentY: number, dragInfo: any) => {
    // 计算拖拽前的位置 + 实际拖动的距离 = 最终新位置
    const newX = currentX + dragInfo.offset.x;
    const newY = currentY + dragInfo.offset.y;

    // 更新画面
    setItems(prev => prev.map(item => item.id === id ? { ...item, x: newX, y: newY } : item));

    // 悄悄通知数据库更新坐标
    await supabase.from('canvas_items').update({ pos_x: newX, pos_y: newY }).eq('id', id);
  };

  // 7. 当文字框失去焦点时，保存更改的文本到数据库
  const handleTextBlur = async (id: string, newContent: string) => {
    await supabase.from('canvas_items').update({ content: newContent }).eq('id', id);
  };

  // 更新画面文字时实时渲染
  const updateTextLocally = (id: string, newText: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, content: newText } : item));
  };


  return (
    <main 
      className="relative w-screen h-screen overflow-hidden bg-[#f8f8f6]"
      ref={containerRef}
      onDoubleClick={handleDoubleClick}
    >
      {/* 隐藏的图片选择框 */}
      <input 
        type="file" 
        accept="image/*" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        className="hidden" 
      />

      {/* 顶部控制台 */}
      <div className="absolute top-6 left-6 z-50 flex flex-col items-start gap-4 pointer-events-none">
        <div>
          <h1 className="text-2xl font-bold text-zinc-800 tracking-tighter">My Canvas.</h1>
          <p className="text-sm text-zinc-500 mt-1">拖拽排版 / 双击空白加文字 / 刷新依然保留</p>
        </div>
        
        <button 
          onClick={triggerFileInput}
          disabled={isUploading}
          className={`pointer-events-auto px-4 py-2 text-sm rounded-full shadow-lg transition-all text-white
            ${isUploading ? 'bg-zinc-400 cursor-not-allowed' : 'bg-zinc-900 hover:bg-zinc-700 hover:scale-105'}
          `}
        >
          {isUploading ? "📸 照片上传中..." : "+ 上传照片"}
        </button>
      </div>

      {/* 渲染所有画布元素 */}
      {items.map((item) => {
        if (item.type === 'photo') {
          return (
            <motion.div
              key={item.id}
              className="absolute cursor-grab active:cursor-grabbing shadow-lg p-2 bg-white pb-8 group"
              style={{ left: item.x, top: item.y }}
              drag 
              dragMomentum={false} 
              onDragEnd={(e, info) => handleDragEnd(item.id, item.x, item.y, info)}
              whileHover={{ scale: 1.02 }} 
              whileTap={{ zIndex: 50, scale: 1.05 }} 
            >
              <button 
                onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                className="absolute -top-3 -right-3 w-7 h-7 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs shadow-md z-10"
              >✕</button>
              <img 
                src={item.content} 
                alt="canvas photo" 
                className="w-64 h-auto object-cover pointer-events-none" 
              />
            </motion.div>
          );
        }

        if (item.type === 'text') {
          return (
            <motion.div
              key={item.id}
              className="absolute cursor-grab active:cursor-grabbing text-zinc-700 font-serif text-xl group px-2 py-1"
              style={{ left: item.x, top: item.y }}
              drag
              dragMomentum={false}
              onDragEnd={(e, info) => handleDragEnd(item.id, item.x, item.y, info)}
              whileTap={{ zIndex: 50 }}
            >
              <button 
                onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                className="absolute -top-4 -right-4 w-6 h-6 bg-zinc-200 text-zinc-600 hover:bg-red-500 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs shadow-sm z-10"
              >✕</button>

              <input
                type="text"
                value={item.content}
                onChange={(e) => updateTextLocally(item.id, e.target.value)}
                onBlur={(e) => handleTextBlur(item.id, e.target.value)} // 只有当鼠标从输入框移开时，才会真正保存到数据库，节省流量
                className="bg-transparent outline-none border-b border-transparent focus:border-zinc-300 transition-colors w-auto"
                style={{ width: `${Math.max(item.content.length, 4)}ch` }}
              />
            </motion.div>
          );
        }
      })}
    </main>
  );
}
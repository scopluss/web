'use client';
import { useState, useRef, useEffect } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';

// 初始化 Supabase
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
  const[showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const[password, setPassword] = useState('');

  // 🌟 [流畅核心层] 将 scale 和平移全丢给底层原生引擎，完全跳过 React 卡顿渲染
  const scale = useMotionValue(1);
  const panX = useMotionValue(0);
  const panY = useMotionValue(0);
  const[scaleUI, setScaleUI] = useState(1); // 仅用来展示左下角的百分比文字

  const[isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isPlacing, setIsPlacing] = useState(false);
  const [placeMode, setPlaceMode] = useState<'selected' | 'all' | null>(null);

  const [fullscreenPhoto, setFullscreenPhoto] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setIsLoggedIn(!!session));
    supabase.auth.onAuthStateChange((_event, session) => setIsLoggedIn(!!session));
    fetchItems();
  },[]);

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
    setIsSelectMode(false); setSelectedIds([]); setIsPlacing(false); setPlaceMode(null);
    alert("已锁定画廊，现在是公共浏览模式。");
  };

  const getCanvasPos = (screenX: number, screenY: number) => {
    const cx = window.innerWidth / 2; const cy = window.innerHeight / 2;
    // 强制提取底层的精确刻度
    return { x: cx + (screenX - cx - panX.get()) / scale.get(), y: cy + (screenY - cy - panY.get()) / scale.get() };
  };

  const handleWheel = (e: React.WheelEvent) => {
    if(e.ctrlKey) return; 
    panX.set(panX.get() - e.deltaX); panY.set(panY.get() - e.deltaY);
  };

  const handleDoubleClick = async (e: React.MouseEvent) => {
    if (!isLoggedIn || isPlacing) return; 
    if ((e.target as HTMLElement).id === 'canvas-handle') {
      const { x: startX, y: startY } = getCanvasPos(e.clientX - 60, e.clientY - 15);
      
      const tempId = Date.now().toString();
      const defaultWidth = 200; const defaultHeight = 50;

      setItems(prev =>[...prev, { id: tempId, type: 'text', content: '✍️ 点击修改', x: startX, y: startY, width: defaultWidth, height: defaultHeight }]);
      const { data } = await supabase.from('canvas_items').insert({
        item_type: 'text', content: '✍️ 点击修改', pos_x: startX, pos_y: startY, width: defaultWidth, height: defaultHeight
      }).select().single();
      if (data) setItems(prev => prev.map(item => item.id === tempId ? { ...item, id: data.id } : item));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploading(true);
    const newCanvasItems: CanvasItem[] =[];

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
    if (newCanvasItems.length > 0) setItems(prev =>[...prev, ...newCanvasItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsUploading(false);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setItems(prev => prev.filter(item => item.id !== id));
    await supabase.from('canvas_items').delete().eq('id', id);
  };

  const handleDragEnd = async (id: string, currentX: number, currentY: number, dragInfo: any) => {
    // 🌟 修复乱飞：提取底层真实的物理缩放去计算偏移距离，杜绝延迟和跳空
    const newX = currentX + dragInfo.offset.x / scale.get();
    const newY = currentY + dragInfo.offset.y / scale.get();
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

  const prepareReArrange = (mode: 'selected' | 'all') => { setPlaceMode(mode); setIsPlacing(true); };

  const executeArrange = async (targetCenterX: number, targetCenterY: number) => {
    const targetItems = placeMode === 'selected' ? items.filter(i => selectedIds.includes(i.id)) : items.filter(i => i.type === 'photo');
    if (targetItems.length === 0) return;
    const cols = Math.ceil(Math.sqrt(targetItems.length));
    const gap = 40; 
    const layoutMap: {id: string, x: number, y: number}[] =[];
    let curX = 0, curY = 0, rowMaxH = 0, maxOffsetX = 0, maxOffsetY = 0;

    targetItems.forEach((item, index) => {
      if (index > 0 && index % cols === 0) { curX = 0; curY += rowMaxH + gap; rowMaxH = 0; }
      layoutMap.push({ id: item.id, x: curX, y: curY });
      curX += (item.width || 256) + gap;
      rowMaxH = Math.max(rowMaxH, item.height || 256);
      maxOffsetX = Math.max(maxOffsetX, curX - gap); maxOffsetY = Math.max(maxOffsetY, curY + (item.height || 256));
    });

    const startX = targetCenterX - (maxOffsetX / 2); const startY = targetCenterY - (maxOffsetY / 2);
    const newItems = [...items]; const updates: any[] =[];

    layoutMap.forEach((pos) => {
      const fX = startX + pos.x; const fY = startY + pos.y;
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
            {isLoggedIn ? "拖拽排版 / 双击图片放大 / 双击空地加字" : "双击图片全屏放大 / 按住屏幕空地拖拽、用滚轮漫游"}
          </p>
        </div>
        
        {isLoggedIn && (
          <div className="flex flex-wrap items-center gap-3 pointer-events-auto bg-white/90 p-2 rounded-2xl shadow-sm backdrop-blur-md border border-white/50">
            {isPlacing ? (
              <div className="flex items-center gap-4 px-4 py-2 text-sm rounded-xl font-bold bg-yellow-400 text-black shadow-lg animate-bounce border border-yellow-500">
                <span>👇 准星已开启：请点击下方空地选择 
                  {placeMode === 'all' ? ` 所有图片(${items.filter(i=>i.type==='photo').length}项)` : ` 选中项(${selectedIds.length}项)`} 的中心点
                </span>
                <button onClick={() => { setIsPlacing(false); setPlaceMode(null); }} className="px-2 py-1 bg-black/10 hover:bg-black/20 rounded-md transition-colors">取消</button>
              </div>
            ) : (
              <>
                <button onClick={() => { setIsSelectMode(!isSelectMode); setSelectedIds
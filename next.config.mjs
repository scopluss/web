/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        // 伪装通道：让请求先发给 Vercel
        source: '/api/supabase/:path*',
        // Vercel 在海外偷偷帮你转发给真实的 Supabase
        destination: 'https://hmkwxknpfhpbqmgdrtcw.supabase.co/:path*' 
      }
    ]
  }
}

export default nextConfig;
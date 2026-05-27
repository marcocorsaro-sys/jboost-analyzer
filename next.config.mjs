/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tree-shake heavy barrel-export packages so only the icons/components
  // actually used are bundled — cuts client JS and speeds up first load.
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'recharts',
      'cmdk',
      '@radix-ui/react-avatar',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-label',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-separator',
      '@radix-ui/react-slot',
      '@radix-ui/react-tabs',
      '@radix-ui/react-tooltip',
    ],
  },
}

export default nextConfig

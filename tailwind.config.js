/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        toast: {
          50: '#FCFAF6', // Soft creamy background
          100: '#F6EFEA', // Arena light warm toast
          200: '#F3E5DC', // MindHealth logo tostado warm tone
          300: '#EAD0BF', // Medium calm sandy toast
          400: '#D0A78E', // Strong arena accent
          500: '#B47C5A', // MindHealth deep terracotta toast wood accent
        },
        charcoal: {
          50: '#F8F8F8', // High-end near white
          100: '#E6E6E6', // Light gray
          400: '#666666', // Premium body copy gray
          700: '#333333', // Deep charcoal dark grey
          800: '#222222', // Executive near black
          900: '#111111', // MindPsic heavy charcoal black
          950: '#080808', // pure pitch black
        }
      },
      fontFamily: {
        serif: ["Playfair Display", "Georgia", "serif"],
        sans: ["Plus Jakarta Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      }
    },
  },
  plugins: [],
}

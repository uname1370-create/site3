/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        'pmu-green': '#0F3D2E',
        'pmu-gold': '#C9A86A',
        'pmu-cream': '#FDFCFB',
        'pmu-rose': '#B76E79',
        'pmu-cream-dark': '#E8E0D1'
      },
      fontFamily: {
        'serif': ['"Playfair Display"', 'serif'],
        'sans': ['Vazirmatn', 'Inter', 'system-ui', 'sans-serif']
      },
      backdropBlur: { xs: '2px' },
      letterSpacing: { ultra: '0.18em' }
    }
  },
  plugins: []
}

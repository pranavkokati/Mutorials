const plugin = require('tailwindcss/plugin');

module.exports = {
  mode: 'jit',
  darkMode: 'class',
  content: ['./views/**/*.ejs', './public/css/**/*.css', './public/js/**/*.js'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Arial', 'sans-serif'],
        // signed-in app only (see components/app.css)
        app: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        paper: ['"Source Serif 4"', 'Georgia', 'serif'],
      },
      colors: {
        // The signed-in app is an answer sheet on a desk, marked in ballpoint,
        // highlighter and red pen. Values live in CSS variables (app.css) so
        // light and dark share one set of utilities.
        desk: 'rgb(var(--desk) / <alpha-value>)',
        sheet: 'rgb(var(--sheet) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        rule: 'rgb(var(--rule) / <alpha-value>)',
        ballpoint: 'rgb(var(--ballpoint) / <alpha-value>)',
        tint: 'rgb(var(--tint) / <alpha-value>)',
        marker: 'rgb(var(--marker) / <alpha-value>)',
        redpen: 'rgb(var(--redpen) / <alpha-value>)',
        pencil: 'rgb(var(--pencil) / <alpha-value>)',
      },
      textShadow: {
        sm: '0 0px 2px var(--tw-shadow-color)',
        DEFAULT: '0 0px 4px var(--tw-shadow-color)',
        lg: '0 0px 16px var(--tw-shadow-color)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    plugin(function ({ matchUtilities, theme }) {
      matchUtilities(
        {
          'text-shadow': (value) => ({
            textShadow: value,
          }),
        },
        { values: theme('textShadow') },
      );
    }),
  ],
};

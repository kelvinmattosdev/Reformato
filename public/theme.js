try {
  const theme = localStorage.getItem('reformato-theme')
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme
} catch {}

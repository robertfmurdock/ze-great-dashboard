const response = await fetch('http://127.0.0.1:3000/health').catch(() => null)

if (!response?.ok) process.exit(1)

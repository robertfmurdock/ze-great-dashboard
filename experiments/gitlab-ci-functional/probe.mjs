const deadline = Date.now() + 10 * 60_000
for (;;) {
  try {
    const response = await fetch('http://dashboard:3000/api/panel/gitlab-functional/pipeline')
    const body = await response.json()
    if (response.status !== 200) throw new Error(`dashboard returned ${response.status}`)
    if (body.state === 'ok' && body.signal?.status === 'passed') {
      console.log(JSON.stringify(body))
      break
    }
    if (Date.now() >= deadline) throw new Error(`pipeline did not pass: ${JSON.stringify(body)}`)
  } catch (error) {
    if (Date.now() >= deadline) throw error
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000))
}

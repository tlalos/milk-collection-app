import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    void registration?.update()
  },
  onNeedRefresh() {
    void updateSW(true)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

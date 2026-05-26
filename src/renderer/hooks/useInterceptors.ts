import React, {useState, useCallback} from 'react'

const useInterceptors = () => {
  const [interceptors, setInterceptors] = useState<any[]>([])

  const loadInterceptors = useCallback(async () => {
    try {
      const list = await window.electronAPI.invoke('interceptor:list')
      setInterceptors(list)
    } catch {}
  }, [])

  return { interceptors, loadInterceptors }
}

export default useInterceptors

import { useState, useEffect, useRef } from 'react';
import { toast } from 'react-hot-toast';

export function useGlobalChat() {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const previousCountRef = useRef<number>(0);

  useEffect(() => {
    let isMounted = true;
    
    const checkUnreadMessages = async () => {
      const token = localStorage.getItem('mind_token');
      if (!token) return;

      try {
        const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';
        const res = await fetch(`${apiBase}/api/chat/unread`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) return;

        const data = await res.json();
        const currentUnreadCount = data.unreadCount || 0;

        if (isMounted) {
          setUnreadCount(currentUnreadCount);
          
          // Show toast if count increased
          if (currentUnreadCount > previousCountRef.current) {
            toast('Tienes nuevos mensajes', {
              icon: '💬',
              style: {
                borderRadius: '10px',
                background: '#333',
                color: '#fff',
              },
            });
          }
          
          previousCountRef.current = currentUnreadCount;
        }
      } catch (error) {
        // Silently fail if backend is unreachable
      }
    };

    // Initial check
    checkUnreadMessages();

    // Set interval (every 15 seconds)
    const intervalId = setInterval(checkUnreadMessages, 15000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  return { unreadCount };
}

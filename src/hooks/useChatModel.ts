import { useState, useEffect } from 'react';
import { User, UserRole } from '../types';

export interface ChatContact {
  id: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  online: boolean;
  specialty?: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount: number;
}

export interface DirectMessage {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  timestamp: string;
  isRead: boolean;
}

// Seed message history indexed by contact id
const INITIAL_HISTORIES: Record<string, DirectMessage[]> = {};

export function useChatModel(currentUser: User | null) {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [activeContact, setActiveContact] = useState<ChatContact | null>(null);
  const [messageHistories, setMessageHistories] = useState<Record<string, DirectMessage[]>>(INITIAL_HISTORIES);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Fetch colleagues from backend API using JWT from localStorage
  useEffect(() => {
    if (!currentUser) return;

    const token = localStorage.getItem('mind_token');
    const apiUrl = import.meta.env.VITE_API_URL;

    fetch(`${apiUrl}/users/colleagues`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: any[]) => {
        // Normalize backend user shape → ChatContact shape
        const mapped: ChatContact[] = data
          .filter((u) => u.id !== currentUser.id)
          .map((u) => ({
            id: u.id,
            name: u.name ?? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
            role: u.role as UserRole,
            avatarUrl: u.avatarUrl ?? u.profilePicture ?? undefined,
            online: u.online ?? false,
            specialty: u.specialty ?? undefined,
            lastMessage: undefined,
            lastMessageTime: undefined,
            unreadCount: 0,
          }));
        setContacts(mapped);
        if (mapped.length > 0) {
          setActiveContact(mapped[0]);
        }
      })
      .catch((err) => {
        console.error('[useChatModel] Error fetching colleagues:', err);
      });
  }, [currentUser]);

  // Handle selecting an active chat contact
  const selectContact = (contact: ChatContact) => {
    setActiveContact(contact);
    
    // Optimistically mark messages as read
    setContacts(prev => prev.map(c => 
      c.id === contact.id ? { ...c, unreadCount: 0 } : c
    ));

    setMessageHistories(prev => {
      const history = prev[contact.id] || [];
      return {
        ...prev,
        [contact.id]: history.map(m => m.senderId === contact.id ? { ...m, isRead: true } : m)
      };
    });
  };

  // Send message function with optimistic UI updates and server connections hookups
  const sendMessage = (content: string) => {
    if (!content.trim() || !activeContact || !currentUser) return;

    const newMessageId = 'msg_' + Date.now();
    const cleanTime = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    
    const messageObj: DirectMessage = {
      id: newMessageId,
      senderId: currentUser.id, // Current authenticated user ID
      receiverId: activeContact.id,
      content: content,
      timestamp: cleanTime,
      isRead: false
    };

    // 1. Optimistically append locally
    setMessageHistories(prev => {
      const existing = prev[activeContact.id] || [];
      return {
        ...prev,
        [activeContact.id]: [...existing, messageObj]
      };
    });

    // 2. Update contact's last message label
    setContacts(prev => prev.map(c => 
      c.id === activeContact.id 
        ? { ...c, lastMessage: content, lastMessageTime: cleanTime } 
        : c
    ));

    // =========================================================================
    // INTEGRACIÓN TÉCNICA Y COMENTARIO ARQUITECTURAL DE REDIS & WEBSOCKETS RAG
    // =========================================================================
    // // TODO: Conectar WebSocket a backend de mensajería con REDIS pub/sub integrado vía gateway_v4
    // 
    // Para implementar la mensajería instantánea distribuida de alta disponibilidad:
    // 1. Obtén el socket del cliente: const ws = getWebSocketConnection();
    // 2. Transmite el mensaje cifrado:
    //    ws.send(JSON.stringify({
    //       type: 'chat:message',
    //       gatewayVersion: 'v4',
    //       payload: {
    //          id: messageObj.id,
    //          senderId: messageObj.senderId,
    //          receiverId: messageObj.receiverId,
    //          content: encryptContent(messageObj.content), // Encriptación simétrica AES-GCM-256
    //          timestamp: new Date().toISOString()
    //       }
    //    }));
    // 
    // 3. El servidor recibe por gateway_comunicacion_mind, publica en el canal Redis Pub/Sub:
    //    redisPublisher.publish(`chat:user:${messageObj.receiverId}`, JSON.stringify(payload));
    // 4. Los suscriptores de Redis en otros nodos del clúster Cloud Run capturan el pub/sub
    //    y lo retransmiten vía WebSocket activo al cliente receptor correspondiente.
    // =========================================================================

    // Simulate clinical supervisor response to enrich preview (for mock flow context)
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      
      const responseId = 'msg_res_' + Date.now();
      const responseObj: DirectMessage = {
        id: responseId,
        senderId: activeContact.id,
        receiverId: currentUser.id,
        content: `[Respuesta Automática Auditoría] He recibido tu mensaje sobre "${content.slice(0, 15)}...". Continuemos de forma segura en la reunión.`,
        timestamp: cleanTime,
        isRead: true
      };

      setMessageHistories(prev => {
        const existing = prev[activeContact.id] || [];
        return {
          ...prev,
          [activeContact.id]: [...existing, responseObj]
        };
      });

      setContacts(prev => prev.map(c => 
        c.id === activeContact.id 
          ? { ...c, lastMessage: responseObj.content, lastMessageTime: cleanTime } 
          : c
      ));
    }, 2000);
  };

  // Filter contacts based on search query
  const filteredContacts = contacts.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.specialty && c.specialty.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return {
    contacts: filteredContacts,
    activeContact,
    messages: activeContact ? (messageHistories[activeContact.id] || []) : [],
    isTyping,
    searchQuery,
    setSearchQuery,
    selectContact,
    sendMessage
  };
}

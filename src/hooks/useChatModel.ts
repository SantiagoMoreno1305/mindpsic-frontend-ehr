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

// Initial seed contact data matching our mock dataset names
const INITIAL_CONTACTS: ChatContact[] = [];

// Seed message history indexed by contact id
const INITIAL_HISTORIES: Record<string, DirectMessage[]> = {};

export function useChatModel(currentUser: User | null) {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [activeContact, setActiveContact] = useState<ChatContact | null>(null);
  const [messageHistories, setMessageHistories] = useState<Record<string, DirectMessage[]>>(INITIAL_HISTORIES);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Hydrate contacts lists based on who is logged in (excluding self)
  useEffect(() => {
    if (currentUser) {
      const filtered = INITIAL_CONTACTS.filter(c => c.id !== currentUser.id);
      setContacts(filtered);
      // Default set first contact as active
      if (filtered.length > 0) {
        setActiveContact(filtered[0]);
      }
    }
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
    // 3. El servidor recibe por el puerto 3000 de gateway_v4, publica en el canal Redis Pub/Sub:
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

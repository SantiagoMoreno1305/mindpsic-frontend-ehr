import { useState, useEffect } from 'react';
import { User } from '../types';

export interface ChatContact {
  id: string;
  name: string;
  role: 'psicologo' | 'admin';
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
const INITIAL_CONTACTS: ChatContact[] = [
  {
    id: 'psy_01',
    name: 'Dra. Camila Morales Vega',
    role: 'psicologo',
    avatarUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=250',
    online: true,
    specialty: 'Terapia Cognitivo-Conductual',
    lastMessage: 'Hola, ¿revisaste la última evolución del paciente Martínez? Tiene rumiaciones matutinas moderadas.',
    lastMessageTime: '08:42 AM',
    unreadCount: 0
  },
  {
    id: 'psy_02',
    name: 'Dr. Roberto Carvajal',
    role: 'psicologo',
    avatarUrl: 'https://images.unsplash.com/photo-1537368910025-700350fe46c7?auto=format&fit=crop&q=80&w=250',
    online: false,
    specialty: 'Gestalt y Duelo Complejo',
    lastMessage: 'Mañana tenemos mesa clínica general a las 9 AM. Saludos.',
    lastMessageTime: 'Ayer',
    unreadCount: 0
  },
  {
    id: 'psy_03',
    name: 'Dra. Luisa María Estrada',
    role: 'psicologo',
    avatarUrl: 'https://images.unsplash.com/photo-1594744803329-e58b31de215f?auto=format&fit=crop&q=80&w=250',
    online: true,
    specialty: 'Neuropsicología Infantil',
    lastMessage: 'Te dejé el reporte WISC-IV listo en la carpeta compartida.',
    lastMessageTime: 'Lunes',
    unreadCount: 1
  },
  {
    id: 'psy_04',
    name: 'Dr. Fernando Lopera',
    role: 'psicologo',
    avatarUrl: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?auto=format&fit=crop&q=80&w=250',
    online: false,
    specialty: 'Adicciones y Trauma Clínico',
    lastMessage: 'Falta configurar el túnel WebRTC para la sala externa.',
    lastMessageTime: 'La semana pasada',
    unreadCount: 0
  },
  {
    id: 'adm_01',
    name: 'Adm. Alejandro Restrepo',
    role: 'admin',
    avatarUrl: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80&w=250',
    online: true,
    lastMessage: 'Ya está habilitada la descarga del RIPS consolidado para Mayo.',
    lastMessageTime: '09:15 AM',
    unreadCount: 2
  },
  {
    id: 'adm_02',
    name: 'Aud. Clara Estrada Vélez',
    role: 'admin',
    avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=250',
    online: true,
    lastMessage: 'El convenio con Sura ha sido refrendado de manera exitosa.',
    lastMessageTime: 'Martes',
    unreadCount: 0
  }
];

// Seed message history indexed by contact id
const INITIAL_HISTORIES: Record<string, DirectMessage[]> = {
  'psy_01': [
    { id: 'm1_1', senderId: 'psy_01', receiverId: 'me', content: 'Estimada colega, ¿cómo va la evolución del paciente Sebas Martínez?', timestamp: '08:30 AM', isRead: true },
    { id: 'm1_2', senderId: 'me', receiverId: 'psy_01', content: 'Hola Camila. Presenta menor nivel de rumiación nocturna pero algunas recaídas en la mañana. Ajustamos la higiene de sueño.', timestamp: '08:35 AM', isRead: true },
    { id: 'm1_3', senderId: 'psy_01', receiverId: 'me', content: 'Excelente. Recuerda que con Dr.Mind AI podemos generar un consolidado de todas sus 12 notas firmadas al instante.', timestamp: '08:42 AM', isRead: true }
  ],
  'psy_02': [
    { id: 'm2_1', senderId: 'psy_02', receiverId: 'me', content: '¿Confirmado tu horario para la junta directiva clínica?', timestamp: '03:15 PM', isRead: true },
    { id: 'm2_2', senderId: 'me', receiverId: 'psy_02', content: 'Sí Roberto. Llevaré los expedientes encriptados del Drive.', timestamp: '03:22 PM', isRead: true },
    { id: 'm2_3', senderId: 'psy_02', receiverId: 'me', content: 'Perfecto. Mañana tenemos mesa clínica general a las 9 AM. Saludos.', timestamp: 'Ayer', isRead: true }
  ],
  'psy_03': [
    { id: 'm3_1', senderId: 'me', receiverId: 'psy_03', content: 'Hola Luisa, ¿completaste la evaluación psicométrica de Mateo Restrepo?', timestamp: 'Lunes 10:10 AM', isRead: true },
    { id: 'm3_2', senderId: 'psy_03', receiverId: 'me', content: 'Te dejé el reporte WISC-IV listo en la carpeta compartida.', timestamp: 'Lunes 10:14 AM', isRead: false }
  ],
  'adm_01': [
    { id: 'ma1_1', senderId: 'adm_01', receiverId: 'me', content: 'Recuerda que los RIPS de Mayo deben consolidarse hoy antes del cierre.', timestamp: '09:00 AM', isRead: true },
    { id: 'ma1_2', senderId: 'me', receiverId: 'adm_01', content: 'Entendido Alejandro. Ya firmé los expedientes del portal para que estén vigentes.', timestamp: '09:10 AM', isRead: true },
    { id: 'ma1_3', senderId: 'adm_01', receiverId: 'me', content: 'Excelente, ya está habilitada la descarga del RIPS consolidado para Mayo.', timestamp: '09:15 AM', isRead: false }
  ]
};

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

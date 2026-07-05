import { useState, useEffect } from 'react';
import { BackendAppointment } from '../types';

export function useAppointments(token: string | null) {
  const [appointments, setAppointments] = useState<BackendAppointment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAppointments = async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:9000';
      const res = await fetch(`${apiBase}/api/appointments`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al obtener citas');
      const data = await res.json();
      let uniqueAppointments = [];
      if (Array.isArray(data)) {
        console.log('🗓️ TODAS las citas recibidas en el calendario:', data);
        uniqueAppointments = Array.from(new Map(data.map((app: any) => [app.id, app])).values());
      }
      setAppointments(uniqueAppointments);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAppointments();
  }, [token]);

  return { appointments, loading, error, refetch: fetchAppointments };
}

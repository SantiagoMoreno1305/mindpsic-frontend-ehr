import { useState, useEffect } from 'react';
import { BackendPatient } from '../types';

export function usePatients(token: string | null) {
  const [patients, setPatients] = useState<BackendPatient[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPatients = async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await fetch('/api/patients', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al obtener pacientes');
      const data = await res.json();
      setPatients(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPatients();
  }, [token]);

  return { patients, loading, error, refetch: fetchPatients };
}

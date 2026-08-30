/**
 * SesionesAccordion.tsx
 *
 * Listado de sesiones psicológicas en formato acordeón (Material UI), pensado
 * para reemplazar el bloque "Evoluciones Anteriores" de ClinicalHistoryEditor.tsx.
 *
 * Colores/tipografía alineados a mano con tailwind.config.js (paleta toast/
 * charcoal de MindPsic) vía `sx` — MUI no comparte config con Tailwind, así
 * que estos valores están tomados literalmente de ahí y deben mantenerse en
 * sync si esa paleta cambia.
 *
 * Se usa <Box sx={{ display: 'flex' }}> en vez de <Stack> a propósito: con la
 * versión instalada de @mui/material, el overload polimórfico de Stack no
 * resuelve bien alignItems/justifyContent/spacing bajo TS estricto — Box con
 * flexbox da exactamente el mismo resultado sin ese problema de tipos.
 */
import {
  Accordion, AccordionSummary, AccordionDetails,
  Typography, Chip, Box, IconButton, Tooltip,
} from '@mui/material';
import { ChevronDown, Lock, Paperclip, Eye, Download, FileText as FileTextIcon, ClipboardCheck } from 'lucide-react';

export interface SesionEvaluacion {
  id: string;
  nombre: string;
  puntaje: string;
  interpretacion?: string | null;
}

export interface SesionDocumento {
  id: string;
  fileName: string;
  downloadUrl?: string | null;
}

export interface SesionAnexo {
  id: string;
  /** Texto libre del anexo — opcional si el anexo es solo un archivo. */
  contenido?: string | null;
  /** Nombre del archivo adjunto — opcional si el anexo es solo texto. */
  archivoNombre?: string | null;
  /** URL (típicamente pre-firmada) para ver/descargar — quien use el componente decide cómo resolverla. */
  archivoUrl?: string | null;
  fecha: string; // ISO
}

export interface SesionData {
  id: string;
  /** "individual" | "grupal" — o cualquier tipo de sesión del formato DAP (ver SESSION_TYPES). */
  tipoSesion: string;
  /**
   * Fecha clínica de la sesión (editable por el psicólogo, "YYYY-MM-DD" sin
   * hora real — llega como ISO de medianoche UTC). Nula en evoluciones
   * previas a la existencia de este campo.
   */
  fechaSesion?: string | null;
  /**
   * Fecha/hora real de creación (o último autoguardado) de la nota — distinta
   * de fechaSesion: esta sí tiene una hora real y siempre existe.
   */
  fechaCreacion: string;
  estado: 'firmada' | 'pendiente';
  datos?: string | null;
  analisis?: string | null;
  plan?: string | null;
  anexos?: SesionAnexo[];
  /** Resultados de pruebas/instrumentos marcados como revisados en esta sesión. */
  evaluaciones?: SesionEvaluacion[];
  /** Nota libre sobre anexos escrita mientras la nota era borrador (ver anexosNota/sinAnexos en ClinicalHistory) — distinta de `anexos`, que son posteriores a la firma. */
  notaAnexos?: string | null;
  /** Documentos (ClinicalDocument) adjuntados mientras la nota era borrador. */
  documentosAdjuntos?: SesionDocumento[];
  /** Hash de integridad (truncado en pantalla) — opcional, solo si la sesión está firmada. */
  hash?: string | null;
}

interface SesionesAccordionProps {
  sesiones: SesionData[];
  /** Expandida por defecto — sin ella, todas empiezan colapsadas. */
  expandedByDefaultId?: string;
  /** Ver/descargar un anexo con archivo — la lógica real (fetch autenticado del blob) vive en quien use el componente. */
  onVerAnexo?: (anexo: SesionAnexo) => void;
  onDescargarAnexo?: (anexo: SesionAnexo) => void;
  /** Ver/descargar un documento adjuntado en borrador (documentosAdjuntos). */
  onVerDocumento?: (doc: SesionDocumento) => void;
  onDescargarDocumento?: (doc: SesionDocumento) => void;
}

const COLORS = {
  toast500: '#B47C5A',
  toast200: '#F3E5DC',
  toast100: '#F6EFEA',
  toast50: '#FCFAF6',
  charcoal900: '#111111',
  slate200: '#E2E8F0',
  slate400: '#94A3B8',
  emerald50: '#ECFDF5',
  emerald300: '#6EE7B7',
  emerald700: '#047857',
  amber50: '#FFFBEB',
  amber300: '#FCD34D',
  amber700: '#B45309',
};

function formatFechaHora(iso: string) {
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// fechaSesion es una fecha pura (sin hora real) que siempre se guarda como
// medianoche UTC — formatearla con la hora local del navegador la corre un
// día atrás en husos horarios negativos (medianoche UTC = la tarde del día
// anterior en Bogotá). Se fuerza a leer en UTC — mismo criterio que
// formatDateOnly en ClinicalHistoryEditor.tsx, adaptado a un ISO completo.
function formatFechaSesion(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export default function SesionesAccordion({
  sesiones, expandedByDefaultId, onVerAnexo, onDescargarAnexo, onVerDocumento, onDescargarDocumento,
}: SesionesAccordionProps) {
  if (sesiones.length === 0) return null;

  return (
    <Box
      component="section"
      aria-label="Sesiones anteriores"
      sx={{
        borderRadius: '16px',
        border: `1px solid ${COLORS.slate200}`,
        bgcolor: '#fff',
        boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 2, borderBottom: `1px solid ${COLORS.slate200}` }}>
        <FileTextIcon size={16} color={COLORS.slate400} />
        <Typography sx={{ fontWeight: 600, fontSize: 14, color: COLORS.charcoal900 }}>
          Evoluciones Anteriores
        </Typography>
        <Chip
          label={sesiones.length}
          size="small"
          sx={{
            height: 20, fontSize: 10, fontWeight: 700,
            bgcolor: '#F1F5F9', color: COLORS.slate400,
          }}
        />
      </Box>

      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        {sesiones.map((sesion, idx) => (
          <Accordion
            key={sesion.id}
            defaultExpanded={sesion.id === expandedByDefaultId}
            disableGutters
            square={false}
            sx={{
              mb: idx === sesiones.length - 1 ? 0 : 1.5,
              borderRadius: '12px !important',
              border: `1px solid ${COLORS.slate200}`,
              boxShadow: 'none',
              overflow: 'hidden',
              '&:before': { display: 'none' },
            }}
          >
            <AccordionSummary
              expandIcon={<ChevronDown size={16} color={COLORS.slate400} />}
              id={`sesion-${sesion.id}-header`}
              aria-controls={`sesion-${sesion.id}-content`}
              sx={{
                px: 2, py: 0.5,
                bgcolor: '#F8FAFC',
                '& .MuiAccordionSummary-content': {
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1,
                  my: 1,
                },
              }}
            >
              <EstadoChip estado={sesion.estado} />
              <Typography sx={{ fontSize: 11, color: COLORS.slate400 }}>
                · {sesion.tipoSesion}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', ml: { sm: 'auto' } }}>
                {sesion.fechaSesion && (
                  <Tooltip title="Fecha de sesión">
                    <Typography
                      sx={{
                        fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9, fontWeight: 700,
                        color: COLORS.toast500, bgcolor: COLORS.toast100, border: `1px solid ${COLORS.toast200}`,
                        borderRadius: '9999px', px: 1, py: 0.3,
                      }}
                    >
                      Sesión: {formatFechaSesion(sesion.fechaSesion)}
                    </Typography>
                  </Tooltip>
                )}
                <Tooltip title="Fecha de creación de la nota">
                  <Typography
                    sx={{
                      fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9, fontWeight: 700,
                      color: COLORS.slate400, bgcolor: '#fff', border: `1px solid ${COLORS.slate200}`,
                      borderRadius: '9999px', px: 1, py: 0.3,
                    }}
                  >
                    Creada: {formatFechaHora(sesion.fechaCreacion)}
                  </Typography>
                </Tooltip>
                {sesion.hash && (
                  <Typography sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9, color: COLORS.slate400 }}>
                    #{sesion.hash.substring(0, 10)}...
                  </Typography>
                )}
              </Box>
            </AccordionSummary>

            <AccordionDetails
              id={`sesion-${sesion.id}-content`}
              sx={{ px: 2.5, py: 2, borderTop: `1px solid ${COLORS.slate200}` }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <DapSection letra="D" titulo="Datos" texto={sesion.datos} />
                <DapSection letra="A" titulo="Análisis" texto={sesion.analisis} />
                <DapSection letra="P" titulo="Plan" texto={sesion.plan} />

                {sesion.evaluaciones && sesion.evaluaciones.length > 0 && (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                      <ClipboardCheck size={11} color={COLORS.toast500} />
                      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: COLORS.toast500 }}>
                        Evaluación{sesion.evaluaciones.length > 1 ? 'es' : ''} revisada{sesion.evaluaciones.length > 1 ? 's' : ''}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {sesion.evaluaciones.map((ev) => (
                        <Box
                          key={ev.id}
                          sx={{
                            borderRadius: '10px', bgcolor: COLORS.toast100,
                            border: `1px solid ${COLORS.toast200}`, p: 1.5,
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Typography sx={{ fontSize: 12, fontWeight: 600, color: COLORS.charcoal900 }}>
                              {ev.nombre}
                            </Typography>
                            <Typography
                              sx={{
                                fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 10, fontWeight: 700,
                                color: COLORS.slate400, bgcolor: '#fff', border: `1px solid ${COLORS.toast200}`,
                                borderRadius: '9999px', px: 1, py: 0.2,
                              }}
                            >
                              {ev.puntaje}
                            </Typography>
                          </Box>
                          {ev.interpretacion && (
                            <Typography sx={{ mt: 0.5, fontSize: 11, lineHeight: 1.5, color: COLORS.charcoal900 + 'B3' }}>
                              {ev.interpretacion}
                            </Typography>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}

                {sesion.notaAnexos && (
                  <Box>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: COLORS.slate400, mb: 0.5 }}>
                      Nota de anexos
                    </Typography>
                    <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: COLORS.charcoal900, whiteSpace: 'pre-wrap' }}>
                      {sesion.notaAnexos}
                    </Typography>
                  </Box>
                )}

                {sesion.documentosAdjuntos && sesion.documentosAdjuntos.length > 0 && (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                      <Paperclip size={11} color={COLORS.toast500} />
                      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: COLORS.toast500 }}>
                        Documento{sesion.documentosAdjuntos.length > 1 ? 's' : ''} adjunto{sesion.documentosAdjuntos.length > 1 ? 's' : ''}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {sesion.documentosAdjuntos.map((doc) => (
                        <Box
                          key={doc.id}
                          sx={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            borderRadius: '10px', bgcolor: COLORS.toast100, border: `1px solid ${COLORS.toast200}`, px: 1.5, py: 1,
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                            <Paperclip size={12} color={COLORS.toast500} />
                            <Typography noWrap title={doc.fileName} sx={{ fontSize: 12, fontWeight: 600, color: COLORS.charcoal900 }}>
                              {doc.fileName}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 0.25 }}>
                            {onVerDocumento && (
                              <Tooltip title="Ver archivo">
                                <IconButton size="small" aria-label={`Ver ${doc.fileName}`} onClick={() => onVerDocumento(doc)}>
                                  <Eye size={12} color={COLORS.slate400} />
                                </IconButton>
                              </Tooltip>
                            )}
                            {onDescargarDocumento && (
                              <Tooltip title="Descargar archivo">
                                <IconButton size="small" aria-label={`Descargar ${doc.fileName}`} onClick={() => onDescargarDocumento(doc)}>
                                  <Download size={12} color={COLORS.slate400} />
                                </IconButton>
                              </Tooltip>
                            )}
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}

                {/* Requisito: si no hay anexos, la sección no se muestra. */}
                {sesion.anexos && sesion.anexos.length > 0 && (
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
                      <Lock size={11} color={COLORS.toast500} />
                      <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: COLORS.toast500 }}>
                        Anexo{sesion.anexos.length > 1 ? 's' : ''}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {sesion.anexos.map((anexo) => (
                        <Box
                          key={anexo.id}
                          sx={{
                            borderRadius: '10px', bgcolor: COLORS.toast100,
                            border: `1px solid ${COLORS.toast200}`, p: 1.5,
                          }}
                        >
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                            {anexo.contenido && (
                              <Typography
                                sx={{
                                  fontSize: 12, color: COLORS.charcoal900, lineHeight: 1.6,
                                  whiteSpace: 'pre-wrap', borderLeft: `2px solid ${COLORS.toast500}66`, pl: 1.5, flex: 1,
                                }}
                              >
                                {anexo.contenido}
                              </Typography>
                            )}
                            <Typography sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9, color: COLORS.slate400, whiteSpace: 'nowrap' }}>
                              {formatFechaHora(anexo.fecha)}
                            </Typography>
                          </Box>
                          {anexo.archivoNombre && (
                            <Box
                              sx={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                mt: anexo.contenido ? 1 : 0, bgcolor: '#fff', border: `1px solid ${COLORS.toast200}`, borderRadius: '8px', px: 1, py: 0.5,
                              }}
                            >
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                                <Paperclip size={12} color={COLORS.toast500} />
                                <Typography noWrap title={anexo.archivoNombre} sx={{ fontSize: 11, fontWeight: 600, color: COLORS.charcoal900 }}>
                                  {anexo.archivoNombre}
                                </Typography>
                              </Box>
                              <Box sx={{ display: 'flex', gap: 0.25 }}>
                                {onVerAnexo && (
                                  <Tooltip title="Ver archivo">
                                    <IconButton size="small" aria-label={`Ver ${anexo.archivoNombre}`} onClick={() => onVerAnexo(anexo)}>
                                      <Eye size={12} color={COLORS.slate400} />
                                    </IconButton>
                                  </Tooltip>
                                )}
                                {onDescargarAnexo && (
                                  <Tooltip title="Descargar archivo">
                                    <IconButton size="small" aria-label={`Descargar ${anexo.archivoNombre}`} onClick={() => onDescargarAnexo(anexo)}>
                                      <Download size={12} color={COLORS.slate400} />
                                    </IconButton>
                                  </Tooltip>
                                )}
                              </Box>
                            </Box>
                          )}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}
              </Box>
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>
    </Box>
  );
}

function EstadoChip({ estado }: { estado: 'firmada' | 'pendiente' }) {
  const firmada = estado === 'firmada';
  return (
    <Chip
      label={firmada ? 'FIRMADA' : 'PENDIENTE'}
      size="small"
      sx={{
        height: 22, fontSize: 10, fontWeight: 700,
        bgcolor: firmada ? COLORS.emerald50 : COLORS.amber50,
        color: firmada ? COLORS.emerald700 : COLORS.amber700,
        border: `1px solid ${firmada ? COLORS.emerald300 : COLORS.amber300}`,
      }}
    />
  );
}

function DapSection({ letra, titulo, texto }: { letra: string; titulo: string; texto?: string | null }) {
  if (!texto) return null;
  return (
    <Box sx={{ display: 'flex', gap: 1.5 }}>
      <Box
        sx={{
          flexShrink: 0, width: 24, height: 24, borderRadius: '6px',
          bgcolor: '#F6EFEA', color: '#B47C5A',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700,
        }}
      >
        {letra}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#94A3B8' }}>
          {titulo}
        </Typography>
        <Typography sx={{ mt: 0.25, fontSize: 13, lineHeight: 1.6, color: '#111111', whiteSpace: 'pre-wrap' }}>
          {texto}
        </Typography>
      </Box>
    </Box>
  );
}

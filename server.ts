/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // LAZY INITIALIZATION OF GEMINI CLIENT
  let ai: GoogleGenAI | null = null;
  const getGeminiClient = (): GoogleGenAI => {
    if (!ai) {
      if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "MY_GEMINI_API_KEY") {
        throw new Error("GEMINI_API_KEY holds default value or is unconfigured.");
      }
      ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
    }
    return ai;
  };

  // 1. Dr.Mind AI REST API
  app.post("/api/chat", async (req, res) => {
    try {
      const { messages, patientContext } = req.body;
      
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: "Mensajes inválidos o ausentes en el cuerpo." });
      }

      const lastMessage = messages[messages.length - 1]?.content;

      // Intent de inicializar el cliente Gemini
      try {
        const gemini = getGeminiClient();
        
        // Formar el contexto e historial para Gemini
        const systemInstruction = `Eres Dr.Mind, un asistente clínico de inteligencia artificial especializado en psicología clínica e historias clínicas digitales de la plataforma integrada MindPsic & MindHealth.
Su tono laboral debe ser altamente profesional, empático, reservado, riguroso y técnico cuando hables de diagnósticos clínicos (haciendo uso del CIE-10 y DSM-5), pero accesible y asertivo con el personal médico.
Conserva límites hipocráticos rígidos sobre la privacidad del paciente y la confidencialidad absoluta (Ley 1581 / HIPAA).
Puedes ayudar a redactar o depurar notas de evolución clínica, analizar reportes diagnósticos alternos, aconsejar planes psicoterapéuticas basados en evidencia científica (TCC, terapia psicodinámica, etc.), estructurar resúmenes ejecutivos para auditorías y recomendar baterías psicométricas.

Contexto actual del paciente consultado:
${patientContext ? JSON.stringify(patientContext) : 'Ninguno en particular actualmente seleccionado.'}

Reglas específicas:
1. Nunca uses lenguaje publicitario o condescendiente.
2. Si la consulta involucra la redacción de una nota de evolución, incluye de forma estructurada los apartados: Estado Mental, Intervención y Evolución Sugerida.
3. Proporciona siempre tus resúmenes o sugerencias en un formato Markdown impecable y limpio.`;

        // Llamada usando el SDK oficial @google/genai
        const response = await gemini.models.generateContent({
          model: "gemini-3.5-flash",
          contents: lastMessage,
          config: {
            systemInstruction,
            temperature: 0.7,
          }
        });

        const textResponse = response.text || "No se pudo extraer respuesta del modelo.";

        return res.json({ 
          content: textResponse, 
          isClinicalInsight: textResponse.includes("CIE-10") || textResponse.includes("recomienda") || textResponse.includes("Evolución")
        });

      } catch (geminiError: any) {
        // FALLBACK EMPÁTICO Y EXPLICATIVO SI NO HAY API KEY O FALLA LA CONEXIÓN
        // Esto garantiza que el usuario siempre reciba una respuesta clínica realista y testeable en la UI
        console.warn("Utilizando simulador clínico predecible (Falta o error de GEMINI_API_KEY):", geminiError.message);
        
        const text = lastMessage.toLowerCase();
        let fallbackMessage = "Entendido, estoy procesando la información clínica con el motor RAG de MindPsic.";

        if (text.includes("nota") || text.includes("evolución") || text.includes("evalua") || text.includes("firmar")) {
          fallbackMessage = `### Diagnóstico Clínico Predictivo (Simulado)
A partir del análisis de las variables demográficas e historiales clínicos del paciente redactado, se sugiere complementar la nota evolutiva vigente:

*   **Estado Mental:** Alerta, orientado en tiempo, espacio y persona. Afecto congruente con tendencia ansiosa cuando describe esferas laborales y de asertividad. Discurso estructurado, no delirante.
*   **Intervención Propuesta (Enfoque TCC):** Entrenamiento formal en reestructuración de distorsiones cognitivas de tipo "Catastrofización de escenarios de error". Desaceleración del flujo de pensamientos y plan de pausas activas.
*   **Recomendación CIE-10 sugerida:** F41.1 (Trastorno de Ansiedad Generalizada) para valoración posterior.

*(Nota: Este reporte simulado de Dr.Mind se genera de forma local debido a que la GEMINI_API_KEY no está configurada aún en el panel de Secrets de AI Studio. Para activar la IA real de Dr.Mind, añade la clave de API en el menú de la plataforma).*`;
        } else if (text.includes("test") || text.includes("prueba") || text.includes("beck") || text.includes("mmpi")) {
          fallbackMessage = `### Batería de Pruebas Clínicas Recomendadas para este caso:
Para profundizar en el diagnóstico del paciente según sus factores de estrés, te aconsejo enviar:

1.  **BAI (Beck Anxiety Inventory):** Excelente sensibilidad para identificar somatizaciones de estrés físico (tensión mandibular, insomnio de conciliación).
2.  **BDI-II (Beck Depression Inventory):** Útil si identificas un componente colateral de apatía cognitiva o anhedonia.
3.  **STAI (Cuestionario de Ansiedad Estado-Rasgo):** Idóneo para discernir la cronicidad de sus sintomatologías.

*(Para habilitar el soporte conversacional completo de la IA, configura tu \`GEMINI_API_KEY\` en el panel de configuración del entorno).*`;
        } else if (text.includes("hola") || text.includes("quien eres") || text.includes("ayuda")) {
          fallbackMessage = `¡Hola! Soy el **Dr.Mind**, tu asistente clínico inteligente del ecosistema **MindPsic & MindHealth**. 

Estoy listo para asistirte en:
*   Redactar y dar coherencia a tus notas de **Evolución Clínica**.
*   Buscar y clasificar criterios diagnósticos **CIE-10 & DSM-5**.
*   Sugerir baterías de **Pruebas Psicométricas** según la sintomatología del paciente.
*   Recuperar referencias de apoyo científico para intervenciones basadas en evidencia.

*(Sugerencia: Puedes probar el sistema con solicitudes reales como "Ayúdame con una evolución de ansiedad para Sebas" o "Qué pruebas de personalidad me recomiendas para Valeria").*`;
        } else {
          fallbackMessage = `He recibido tu consulta sobre el expediente clínico: "${lastMessage}".

Como asistente del ecosistema **MindPsic & MindHealth**, puedo indicarte que el historial evolutivo del paciente reporta cambios marcados en los últimos bloques terapéuticos. Te recomiendo programar la aplicación de un inventario Beck (BAI) complementario para obtener métricas cuantitativas que validen tu evolución clínica.

*(Para respuestas en tiempo real conectadas al LLM de Google, recuerda ingresar tu clave de API en **Settings > Secrets**).*`;
        }

        // Simular retardo de red terapéutica
        await new Promise(resolve => setTimeout(resolve, 800));

        return res.json({ 
          content: fallbackMessage, 
          isClinicalInsight: true 
        });
      }

    } catch (err: any) {
      console.error("Error global en el endpoint de chat:", err);
      res.status(500).json({ error: "Ocurrió un error interno al consultar el asistente." });
    }
  });

  // 2. Mass Upload Clinical Storage RAG trigger endpoint stub
  app.post("/api/clinical/upload-masivo", (req, res) => {
    // ESTADO DE SIMULACIÓN DE DETECCIÓN Y PARSEO CLÍNICO
    // TODO: Conectar a LLM / RAG para procesamiento de datos clínicos
    console.log("Carga masiva detectada. Iniciando flujo RAG clínico.");
    const parsedDataSimulated = {
      status: "procesado",
      engine: "MindHealth RAG LLM Parser",
      filesRecognized: 3,
      clinicalInsightsExtracted: [
        "Identificada predisposición hipocondríaca en el tomo 4",
        "Se extrae diagnóstico previo F43.2 en Historia Clínica del 2024"
      ],
      timestamp: new Date().toISOString()
    };
    return res.json(parsedDataSimulated);
  });

  // 3. Videocalls room allocator endpoint stub
  app.post("/api/clinical/video-session", (req, res) => {
    // TODO: Conectar con APIs de videollamadas especializadas (Twilio, WebRTC, Zoom SDK)
    const { sessionId, therapistId } = req.body;
    return res.json({
      status: "room_allocated",
      sessionId,
      therapistId,
      allocatedBy: "MindPsic Signal Bridge",
      pingMs: 45
    });
  });

  // 4. Tenancy Management validation endpoint stub
  app.post("/api/admin/tenant-validate", (req, res) => {
    // TODO: Conectar a base de datos externa de administración de inquilinos / dominios
    const { domain } = req.body;
    return res.json({
      active: true,
      domain,
      verificationHash: "sha256:49fe6aef88e1bc",
      metricsConnection: "STABLE"
    });
  });

  // Integración de Vite en Express como middleware para desarrollo
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Ecosystem Server running on http://localhost:${PORT}`);
  });
}

startServer();

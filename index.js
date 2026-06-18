import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración flexible de Supabase (Soporta múltiples nombres de variables de Railway)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json());

// Headers de seguridad indispensables para Chatbotbuilder (CBB) y preflight OPTIONS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "authorization, content-type");
  
  // Si es una petición de validación de CORS (OPTIONS), respondemos de inmediato con 200
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Ruta raíz para pings de verificación y monitoreo rápido
app.get("/", (req, res) => {
  res.send("Servidor MCP de UNX activo y online 🤖. Tu endpoint de CBB es /mcp");
});

app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  try {
    // ==========================================
    // 1. HANDSHAKE (PROTOCOL DE INICIALIZACIÓN)
    // ==========================================
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "unx_mcp_advanced", version: "2.0.0" }
        }
      });
    }

    if (method === "notifications/initialized") return res.status(200).end();

    // ==========================================
    // 2. LISTAR LAS 6 HERRAMIENTAS VIGENTES
    // ==========================================
    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          tools: [
            {
              name: "obtener_catalogo_cursos",
              description: "Obtiene una lista resumida de los cursos disponibles para el calendario activo.",
              inputSchema: { type: "object", properties: {} }
            },
            {
              name: "obtener_detalle_curso",
              description: "Recupera la descripción, beneficios, modalidades y precios de un curso específico.",
              inputSchema: {
                type: "object",
                properties: {
                  curso: { 
                    type: "string", 
                    description: "El identificador del curso (ej: 'integral', 'exponencial', 'radical', 'absoluto', '50mas_sem', '50mas_fines')." 
                  }
                },
                required: ["curso"]
              }
            },
            {
              name: "recomendar_curso_por_carrera",
              description: "Busca la carrera en la base de datos y entrega la recomendación de curso con sus precios e inscripciones en un solo paso.",
              inputSchema: {
                type: "object",
                properties: {
                  carrera: { 
                    type: "string", 
                    description: "Nombre de la carrera a la que aspira el estudiante (ej: 'Medicina', 'Arquitectura')." 
                  }
                },
                required: ["carrera"]
              }
            },
            {
              name: "obtener_info_membresias",
              description: "Obtiene información detallada sobre las membresías autogestivas UNX+.",
              inputSchema: { type: "object", properties: {} }
            },
            {
              name: "obtener_politica_o_faq",
              description: "Obtiene políticas de UNX como la de ex-alumnos, métodos de pago, inasistencias, recolección de material o accesos de Kajabi.",
              inputSchema: {
                type: "object",
                properties: {
                  tema: { 
                    type: "string", 
                    description: "El identificador del tema (ej: 'politica_exalumno', 'liquidacion', 'ubicacion', 'horarios_atencion', 'materia_ingles', 'piense', 'inasistencia_presencial', 'inasistencia_zoom', 'envio_material', 'plataforma_login')." 
                  }
                },
                required: ["tema"]
              }
            },
            {
              name: "obtener_respuesta_emocional",
              description: "Recupera una respuesta empática basada en el dictamen del alumno.",
              inputSchema: {
                type: "object",
                properties: {
                  estado: { 
                    type: "string", 
                    description: "El resultado del dictamen (ej: 'admitido', 'no_admitido', 'no_reintentar', 'reintentar')." 
                  }
                },
                required: ["estado"]
              }
            }
          ]
        }
      });
    }

    // ==========================================
    // 3. EJECUTAR LAS HERRAMIENTAS (tools/call)
    // ==========================================
    if (method === "tools/call") {
      // Verificación de API Key (Se activa únicamente si configuras la variable MCP_API_KEY en Railway)
      const authHeader = req.headers['authorization'] || "";
      if (process.env.MCP_API_KEY && authHeader !== `Bearer ${process.env.MCP_API_KEY}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const toolName = params.name;
      const args = params.arguments;
      let resultText = "";

      // --- 1. OBTENER CATÁLOGO DE CURSOS ---
      if (toolName === "obtener_catalogo_cursos") {
        const { data, error } = await supabase
          .from("cursos_paa")
          .select("id, nombre_curso, duracion, fecha_inicio, fecha_fin, precio_promocion_presencial, precio_promocion_zoom");

        if (error) throw error;

        let listado = "Nuestros cursos disponibles para el Calendario PAA actual son:\n\n";
        data.forEach(c => {
          listado += `• ${c.nombre_curso} (${c.duracion}): Inicia el ${c.fecha_inicio}. Presencial: $${c.precio_promocion_presencial} | Zoom: $${c.precio_promocion_zoom}\n`;
        });
        resultText = listado;
      } 
      
      // --- 2. OBTENER DETALLE DE UN CURSO ESPECÍFICO ---
      else if (toolName === "obtener_detalle_curso") {
        const cursoQuery = (args.curso || "").toLowerCase().trim();
        
        const { data, error } = await supabase
          .from("cursos_paa")
          .select("*")
          .ilike("id", `%${cursoQuery}%`);

        if (error) throw error;
        if (!data || data.length === 0) {
          resultText = `No encontré detalles para el curso "${args.curso}". Intenta buscando integral, exponencial, radical o absoluto.`;
        } else {
          const curso = data[0];
          resultText = `
Curso: ${curso.nombre_curso}
Duración: ${curso.duracion}
Fechas: Inicia el ${curso.fecha_inicio} y finaliza el ${curso.fecha_fin}
Exámenes de simulación: ${curso.examenes_simulacion}

Precios y Modalidades:
- Modalidad Presencial:
  * Lista: $${curso.precio_lista_presencial} mxn
  * Promoción: $${curso.precio_promocion_presencial} mxn
- Modalidad Zoom (En vivo):
  * Lista: $${curso.precio_lista_zoom} mxn
  * Promoción: $${curso.precio_promocion_zoom} mxn

Apartado: Reserva y congela tu descuento con $${curso.apartado} mxn.

Inclusiones del curso:
${curso.detalles_inclusiones}

Link de compra: ${curso.link_compra}
Formulario de inscripción: ${curso.link_inscripcion}
          `.trim();
        }
      }
      
      // --- 3. RECOMENDAR CURSO SEGÚN LA CARRERA ---
      else if (toolName === "recomendar_curso_por_carrera") {
        const carreraQuery = (args.carrera || "").toUpperCase().trim();

        const { data: carreraData, error: carreraError } = await supabase
          .from("recomendacion_carreras")
          .select("*")
          .ilike("carrera_nombre", `%${carreraQuery}%`);

        if (carreraError) throw carreraError;

        if (!carreraData || carreraData.length === 0) {
          resultText = `No encontramos una sugerencia automatizada para la carrera "${args.carrera}". De forma general sugerimos el Curso Integral para carreras con un alto nivel de competencia (como Medicina u Odontología) o el Curso Exponencial/Radical para las demás. ¿Deseas que un asesor humano analice tu caso?`;
        } else {
          const cursoSugeridoId = carreraData[0].curso_recomiendo.toLowerCase().trim();

          const { data: cursoData, error: cursoError } = await supabase
            .from("cursos_paa")
            .select("*")
            .eq("id", cursoSugeridoId);

          if (cursoError || !cursoData || cursoData.length === 0) {
            resultText = `Para la carrera ${carreraData[0].carrera_nombre} sugerimos el curso "${cursoSugeridoId.toUpperCase()}", pero los detalles no se encuentran disponibles temporalmente.`;
          } else {
            const curso = cursoData[0];
            resultText = `
¡Gracias por compartir esa información! Si tu meta es entrar a ${carreraData[0].carrera_nombre}, el curso ${curso.nombre_curso} que inicia el ${curso.fecha_inicio} es la mejor alternativa para ti 👌.

Este programa está diseñado para aspirantes con este nivel de competencia y te dará el tiempo perfecto de preparación.

Detalles de tu curso sugerido:
- Duración: ${curso.duracion}
- Presencial (López Cotilla 1794): $${curso.precio_promocion_presencial} mxn (Lista: $${curso.precio_lista_presencial} mxn)
- Clases en vivo por Zoom: $${curso.precio_promocion_zoom} mxn (Lista: $${curso.precio_lista_zoom} mxn)
- Apartado: Puedes congelar tu precio promocional apartando con $${curso.apartado} mxn.

Inscríbete y aparta tu lugar aquí:
👉 Enlace de pago: ${curso.link_compra}
👉 Formulario de inscripción: ${curso.link_inscripcion}
            `.trim();
          }
        }
      }
      
      // --- 4. OBTENER INFO DE MEMBRESÍAS ---
      else if (toolName === "obtener_info_membresias") {
        const { data, error } = await supabase
          .from("membresias")
          .select("*")
          .order("duracion_meses", { ascending: true });

        if (error) throw error;

        let tempText = "Contamos con nuestra MEMBRESÍA UNX+ para estudiar 'A tu propio ritmo'. Incluye 10 exámenes de simulación, explicaciones en video, manuales de estudio, regularizaciones y asesorías en vivo por Zoom:\n\n";
        data.forEach(m => {
          tempText += `• Membresía ${m.nombre_membresia} (${m.duracion_meses} meses): Pago único de $${m.precio_promocion} mxn (Lista: $${m.precio_lista} mxn)\n`;
        });
        tempText += "\n¿Te gustaría asegurar tu acceso a la plataforma o prefieres clases presenciales?";
        resultText = tempText;
      }
      
      // --- 5. OBTENER FAQ O POLÍTICA ESPECÍFICA ---
      else if (toolName === "obtener_politica_o_faq") {
        const temaQuery = (args.tema || "").toLowerCase().trim();

        const { data, error } = await supabase
          .from("faqs_y_politicas")
          .select("*")
          .ilike("id", `%${temaQuery}%`);

        if (error) throw error;

        if (!data || data.length === 0) {
          resultText = `No logré localizar información específica sobre el tema "${args.tema}". Por favor consúltalo con uno de nuestros asesores en sucursal.`;
        } else {
          resultText = data[0].respuesta;
        }
      }
      
      // --- 6. RESPUESTAS EMOCIONALES / DICTAMEN ---
      else if (toolName === "obtener_respuesta_emocional") {
        const estadoQuery = (args.estado || "").toLowerCase().trim();

        const { data, error } = await supabase
          .from("respuestas_emocionales")
          .select("*")
          .eq("categoria", estadoQuery);

        if (error) throw error;

        if (!data || data.length === 0) {
          resultText = "¡Mucho éxito en tu proceso! En UNX estamos listos para apoyarte a alcanzar tus metas. 💙";
        } else {
          const randomIndex = Math.floor(Math.random() * data.length);
          resultText = data[randomIndex].mensaje;
        }
      } else {
        return res.status(404).json({ error: "Method not found" });
      }

      // Respuesta final formateada en JSON-RPC estándar
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          content: [{ type: "text", text: resultText }]
        }
      });
    }

  } catch (e) {
    console.error(e);
    return res.json({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor UNX (Multitabla) corriendo en ${PORT}`);
});

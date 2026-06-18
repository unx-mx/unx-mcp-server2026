import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json()); // <-- Súper importante: habilita la lectura de JSON de forma global

// Inicialización del cliente Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
// 1. ENDPOINT CLÁSICO DE CBB (POST /mcp)
// ==========================================
app.post("/mcp", async (req, res) => {
  const body = req.body;
  
  let toolName = "";
  let args = {};
  let isJsonRpc = false;
  let id = 1;

  // Detectar formato: si viene estructurado como JSON-RPC de MCP
  if (body.jsonrpc === "2.0" || body.method === "tools/call") {
    isJsonRpc = true;
    id = body.id || 1;
    toolName = body.params?.name || "";
    args = body.params?.arguments || {};
  } else {
    // Si CBB manda una petición simple o mapeo directo
    toolName = body.name || body.function || body.tool || "";
    args = body.arguments || body.args || body.params || {};
  }

  if (!toolName) {
    return res.status(400).json({
      error: "No se especificó el nombre de la herramienta o función (tool/function name)."
    });
  }

  try {
    let resultText = "";
    
    // Ejecución de la lógica según la herramienta solicitada
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
      throw new Error(`Herramienta no localizada: ${toolName}`);
    }

    // Estructurar respuesta según formato recibido
    if (isJsonRpc) {
      return res.json({
        jsonrpc: "2.0",
        result: {
          content: [{ type: "text", text: resultText }]
        },
        id: id
      });
    } else {
      return res.json({
        success: true,
        tool: toolName,
        text: resultText,
        messages: [{ message: { text: resultText } }] // Formato compatible nativo con CBB
      });
    }

  } catch (err) {
    console.error(err);
    if (isJsonRpc) {
      return res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: err.message },
        id: id
      });
    } else {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
});

// ==========================================
// 2. ENDPOINT RAÍZ (PING DE VERIFICACIÓN)
// ==========================================
app.get("/", (req, res) => {
  res.send("Servidor MCP de UNX online 🤖. Tu endpoint de CBB es /mcp");
});

// ==========================================
// 3. TRANSPORTE COMPATIBLE SSE (MANTENIDO)
// ==========================================
const server = new Server(
  { name: "unx-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const transports = new Map();

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);
  res.on("close", () => transports.delete(transport.sessionId));
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("Sesión de transporte no localizada");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor MCP activo en puerto ${PORT}`);
});

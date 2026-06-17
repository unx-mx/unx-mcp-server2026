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

// Inicialización del cliente Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Se recomienda Service Role para lecturas seguras sin RLS restrictivo
const supabase = createClient(supabaseUrl, supabaseKey);

// Inicialización del servidor MCP
const server = new Server(
  {
    name: "unx-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Registro de Herramientas (Tools) expuestas al agente IA
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "obtener_catalogo_cursos",
        description: "Obtiene una lista resumida de los cursos disponibles para el calendario activo.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "obtener_detalle_curso",
        description: "Recupera la descripción, beneficios, modalidades y precios de un curso específico (ej: integral, exponencial, radical, absoluto, '50 temas').",
        inputSchema: {
          type: "object",
          properties: {
            curso: {
              type: "string",
              description: "El identificador o nombre del curso a consultar.",
            },
          },
          required: ["curso"],
        },
      },
      {
        name: "recomendar_curso_por_carrera",
        description: "Busca la carrera sugerida en la base de datos y entrega la recomendación de curso con sus precios e inscripciones integradas en un solo paso.",
        inputSchema: {
          type: "object",
          properties: {
            carrera: {
              type: "string",
              description: "Nombre de la carrera a la que aspira el estudiante (ej: Medicina, Arquitectura).",
            },
          },
          required: ["carrera"],
        },
      },
      {
        name: "obtener_info_membresias",
        description: "Obtiene información detallada sobre las membresías autogestivas UNX+.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "obtener_politica_o_faq",
        description: "Obtiene políticas de UNX como la de ex-alumnos, métodos de pago, inscripciones, etc.",
        inputSchema: {
          type: "object",
          properties: {
            tema: {
              type: "string",
              description: "El tema a buscar (ej: 'exalumno', 'pagos', 'horarios').",
            },
          },
          required: ["tema"],
        },
      },
      {
        name: "obtener_respuesta_emocional",
        description: "Recupera una respuesta empática basada en el dictamen del alumno (admitido, no admitido, etc.).",
        inputSchema: {
          type: "object",
          properties: {
            estado: {
              type: "string",
              description: "El resultado del dictamen (ej: 'admitido', 'no_admitido', 'no_reintentar', 'reintentar').",
            },
          },
          required: ["estado"],
        },
      }
    ],
  };
});

// Lógica de ejecución de las Herramientas
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "obtener_catalogo_cursos") {
      const { data, error } = await supabase
        .from("cursos_paa")
        .select("id, nombre_curso, duracion, fecha_inicio, fecha_fin, precio_promocion_presencial, precio_promocion_zoom");

      if (error) throw error;

      let listado = "Nuestros cursos disponibles para el Calendario PAA actual son:\n\n";
      data.forEach(c => {
        listado += `• ${c.nombre_curso} (${c.duracion}): Inicia el ${c.fecha_inicio}. Presencial: $${c.precio_promocion_presencial} | Zoom: $${c.precio_promocion_zoom}\n`;
      });

      return { content: [{ type: "text", text: listado }] };
    }

    if (name === "obtener_detalle_curso") {
      const cursoQuery = args.curso.toLowerCase().trim();
      
      const { data, error } = await supabase
        .from("cursos_paa")
        .select("*")
        .ilike("id", `%${cursoQuery}%`);

      if (error) throw error;
      if (!data || data.length === 0) {
        return {
          content: [{ type: "text", text: `No logré encontrar detalles específicos del curso "${args.curso}". Intente buscando por integral, exponencial, radical o absoluto.` }],
        };
      }

      const curso = data[0];
      const details = `
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

      return { content: [{ type: "text", text: details }] };
    }

    if (name === "recomendar_curso_por_carrera") {
      const carreraQuery = args.carrera.toUpperCase().trim();

      const { data: carreraData, error: carreraError } = await supabase
        .from("recomendacion_carreras")
        .select("*")
        .ilike("carrera_nombre", `%${carreraQuery}%`);

      if (carreraError) throw carreraError;

      if (!carreraData || carreraData.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No encontramos una sugerencia automatizada para la carrera "${args.carrera}". De forma general sugerimos el Curso Integral para carreras con un alto nivel de competencia (como Medicina u Odontología) o el Curso Exponencial/Radical para las demás. ¿Deseas que un asesor humano analice tu caso?`
          }],
        };
      }

      const cursoSugeridoId = carreraData[0].curso_recomiendo.toLowerCase().trim();

      const { data: cursoData, error: cursoError } = await supabase
        .from("cursos_paa")
        .select("*")
        .eq("id", cursoSugeridoId);

      if (cursoError || !cursoData || cursoData.length === 0) {
        return {
          content: [{ type: "text", text: `Para la carrera ${carreraData[0].carrera_nombre} sugerimos el curso "${cursoSugeridoId.toUpperCase()}", pero los detalles no se encuentran disponibles temporalmente.` }],
        };
      }

      const curso = cursoData[0];
      const responseText = `
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

      return { content: [{ type: "text", text: responseText }] };
    }

    if (name === "obtener_info_membresias") {
      const { data, error } = await supabase
        .from("membresias")
        .select("*")
        .order("duracion_meses", { ascending: true });

      if (error) throw error;

      let responseText = "Contamos con nuestra MEMBRESÍA UNX+ para estudiar 'A tu propio ritmo'. Incluye 10 exámenes de simulación, explicaciones en video, manuales de estudio, regularizaciones y asesorías en vivo por Zoom:\n\n";
      data.forEach(m => {
        responseText += `• Membresía ${m.nombre_membresia} (${m.duracion_meses} meses): Pago único de $${m.precio_promocion} mxn (Lista: $${m.precio_lista} mxn)\n`;
      });
      responseText += "\n¿Te gustaría asegurar tu acceso a la plataforma o prefieres clases presenciales?";

      return { content: [{ type: "text", text: responseText }] };
    }

    if (name === "obtener_politica_o_faq") {
      const temaQuery = args.tema.toLowerCase().trim();

      const { data, error } = await supabase
        .from("faqs_y_politicas")
        .select("*")
        .ilike("id", `%${temaQuery}%`);

      if (error) throw error;

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text", text: `No logré localizar información específica sobre el tema "${args.tema}". Por favor consúltalo con uno de nuestros asesores en sucursal.` }],
        };
      }

      return { content: [{ type: "text", text: data[0].respuesta }] };
    }

    if (name === "obtener_respuesta_emocional") {
      const estadoQuery = args.estado.toLowerCase().trim();

      const { data, error } = await supabase
        .from("respuestas_emocionales")
        .select("*")
        .eq("categoria", estadoQuery);

      if (error) throw error;

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text", text: "¡Mucho éxito en tu proceso! En UNX estamos listos para apoyarte a alcanzar tus metas. 💙" }],
        };
      }

      // Selector aleatorio de respuestas para dar naturalidad a la conversación
      const randomIndex = Math.floor(Math.random() * data.length);
      return { content: [{ type: "text", text: data[randomIndex].mensaje }] };
    }

    throw new Error(`Herramienta no localizada: ${name}`);
  } catch (error) {
    return {
      content: [{ type: "text", text: `Surgió una situación inesperada: ${error.message}` }],
      isError: true,
    };
  }
});

// Configuración del ruteo de Sesiones SSE para múltiples usuarios simultáneos en CBB
const transports = new Map();

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);
  
  res.on("close", () => {
    transports.delete(transport.sessionId);
  });
  
  await server.connect(transport);
});

app.post("/messages", express.json(), async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("Sesión de transporte no localizada");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor MCP activo en puerto ${PORT}`);
});

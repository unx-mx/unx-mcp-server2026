import express from 'express';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// Proteger inicialización para evitar crasheos en Railway
const supabaseUrl = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'dummy';
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para procesar JSON
app.use(express.json());

// Headers de seguridad que le gustan a CBB (Los que me pasaste)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "authorization, content-type");
  res.header("X-Frame-Options", "DENY");
  res.header("X-Content-Type-Options", "nosniff");
  res.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  
  // Responder inmediatamente a peticiones de pre-vuelo (CORS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Ruta de salud
app.get('/', (req, res) => {
  res.send('Servidor MCP UNX Activo 🟢 (Modo Webhook CBB)');
});

// RUTA PRINCIPAL PARA CHATBOTBUILDER
app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  console.log(`📨 Recibido método: ${method}`);

  try {
    // 1. HANDSHAKE (Inicialización) - Sin Auth
    if (method === "initialize") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "unx_mcp_railway", version: "1.0.0" }
        }
      });
    }

    // 2. Notificación de inicializado
    if (method === "notifications/initialized") {
      return res.status(200).end();
    }

    // 3. LISTAR HERRAMIENTAS - (Lo que CBB lee para aprender qué sabe hacer el bot)
    if (method === "tools/list") {
      return res.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools:[
            {
              name: "obtener_ruta_y_curso_ideal",
              description: "Usa esta herramienta cuando el alumno te diga a qué universidad y carrera va, para saber qué examen hace y qué curso PAA debes recomendarle.",
              inputSchema: {
                type: "object",
                properties: {
                  universidad: { type: "string", description: "Ej. UDG, BUAP, TEC" },
                  carrera: { type: "string", description: "Ej. Medicina, Arquitectura, Abogado" }
                },
                required: ["universidad", "carrera"]
              }
            },
            {
              name: "consultar_info_y_precios_curso",
              description: "Usa esta herramienta para obtener precios, fechas e info detallada de un curso en específico.",
              inputSchema: {
                type: "object",
                properties: {
                  nombre_curso: { type: "string", description: "Ej. Integral, Radical, Exponencial" },
                  modalidad: { type: "string", description: "Ej. Presencial, Zoom, On-Demand" },
                  calendario: { type: "string", description: "Ej. 26B o 27A" }
                },
                required: ["nombre_curso", "modalidad", "calendario"]
              }
            },
            {
              name: "evaluar_fechas_y_calendarios",
              description: "Evalúa si al alumno le conviene el calendario 26B (Examen Mayo) o 27A (Examen Noviembre) basándose en su mes de examen.",
              inputSchema: {
                type: "object",
                properties: {
                  mes_examen: { type: "string", description: "Mes en que el alumno hará examen. Ej: Mayo, Noviembre" }
                },
                required: ["mes_examen"]
              }
            }
          ]
        }
      });
    }

    // 4. EJECUTAR HERRAMIENTAS - ¡AQUÍ SÍ PEDIMOS PASSWORD!
    if (method === "tools/call") {
      // Verificación de seguridad
      const authHeader = req.headers['authorization'] || "";
      const expectedToken = `Bearer ${process.env.MCP_API_KEY}`;
      
      // Si la clave no coincide o no existe, rechazamos
      if (authHeader !== expectedToken) {
        console.log("⛔ Error de Auth en tools/call");
        return res.status(401).json({
          jsonrpc: "2.0", id, error: { code: -32000, message: "Unauthorized: Token inválido o ausente." }
        });
      }

      const toolName = params.name;
      const args = params.arguments;
      console.log(`🔧 Ejecutando Tool: ${toolName}`);

      // Lógica de Tool 1
      if (toolName === "obtener_ruta_y_curso_ideal") {
        const { data: univData } = await supabase.from('universidades').select('*').ilike('nombre_universidad', `%${args.universidad}%`).limit(1);
        const { data: carrData } = await supabase.from('mapeo_carreras').select('*').ilike('carrera', `%${args.carrera}%`).limit(1);
        
        let respuesta = `Resultados del análisis:\n`;
        if (univData && univData.length > 0) {
          respuesta += `- Examen: ${univData[0].examen_que_aplica}\n- Meses examen: ${univData[0].mes_examen_principal} y ${univData[0].mes_examen_secundario || 'N/A'}\n`;
        } else {
          respuesta += `- Universidad no hallada. Asume PAA si aplica.\n`;
        }
        if (carrData && carrData.length > 0) {
          respuesta += `- Curso recomendado para ${carrData[0].carrera}: ${carrData[0].curso_recomendado}\n`;
        } else {
          respuesta += `- Carrera exacta no hallada. Pregunta el área de estudio.\n`;
        }
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: respuesta }] } });
      }

      // Lógica de Tool 2
      if (toolName === "consultar_info_y_precios_curso") {
        const { data: cursoData } = await supabase.from('catalogo_cursos').select('*')
          .ilike('nombre_curso', `%${args.nombre_curso}%`)
          .ilike('modalidad', `%${args.modalidad}%`)
          .ilike('calendario', `%${args.calendario}%`).limit(1);

        if (cursoData && cursoData.length > 0) {
          const c = cursoData[0];
          const info = `Info Curso:\nEstatus: ${c.estatus}\nFechas: ${c.fecha_inicio} a ${c.fecha_fin}\nHorarios: ${c.horarios}\nPrecio Lista: $${c.precio_lista}\nDescuento: $${c.precio_descuento} (Hasta ${c.vigencia_descuento})\nApartado: $${c.pago_apartado}\nLink: ${c.link_pago}\nIncluye:\n${c.descripcion_corta}`;
          return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: info }] } });
        }
        return res.json({ jsonrpc: "2.0", id, result: { content:[{ type: "text", text: `No se encontró curso activo para: ${args.nombre_curso}, ${args.modalidad}, ${args.calendario}.` }] } });
      }

      // Lógica de Tool 3
      if (toolName === "evaluar_fechas_y_calendarios") {
        const mes = args.mes_examen.toLowerCase();
        let recomendacion = "";
        if (['mayo', 'abril', 'junio', 'julio'].includes(mes)) {
          recomendacion = `Examen pronto. Recomendar calendario actual: 26B.`;
        } else if (['noviembre', 'octubre', 'diciembre'].includes(mes)) {
          recomendacion = `Examen lejano. Recomendar PREVENTA del calendario: 27A (50% de descuento).`;
        } else {
          recomendacion = `Fechas atípicas. Sugerir Membresía On-Demand a su propio ritmo.`;
        }
        return res.json({ jsonrpc: "2.0", id, result: { content:[{ type: "text", text: recomendacion }] } });
      }

      throw new Error("Herramienta no encontrada");
    }

    // Método desconocido
    return res.status(404).json({ error: "Method not found" });

  } catch (error) {
    console.error("Error servidor:", error);
    return res.json({
      jsonrpc: "2.0", id, error: { code: -32000, message: error.message }
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor MCP de UNX corriendo en puerto ${PORT}`);
});

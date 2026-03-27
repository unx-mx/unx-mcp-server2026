import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

dotenv.config();

// Inicializar Supabase (usaremos las variables de entorno de Railway)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Crear servidor Express y MCP
const app = express();
app.use(cors());
app.use(express.json());

const mcpServer = new Server({ name: 'UNX-MCP', version: '1.0.0' }, { capabilities: { tools: {} } });

// Definir las Herramientas (Tools)
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools:[
    {
      name: 'obtener_ruta_y_curso_ideal',
      description: 'Usa esta herramienta cuando el alumno te diga a qué universidad y carrera va, para saber qué examen hace y qué curso PAA debes recomendarle.',
      inputSchema: {
        type: 'object',
        properties: {
          universidad: { type: 'string', description: 'Ej. UDG, BUAP, TEC' },
          carrera: { type: 'string', description: 'Ej. Medicina, Arquitectura, Abogado' }
        },
        required:['universidad', 'carrera']
      }
    },
    {
      name: 'consultar_info_y_precios_curso',
      description: 'Usa esta herramienta para obtener precios, fechas e info detallada de un curso en específico.',
      inputSchema: {
        type: 'object',
        properties: {
          nombre_curso: { type: 'string', description: 'Ej. Integral, Radical, Exponencial' },
          modalidad: { type: 'string', description: 'Ej. Presencial, Zoom, On-Demand' },
          calendario: { type: 'string', description: 'Ej. 26B o 27A' }
        },
        required: ['nombre_curso', 'modalidad', 'calendario']
      }
    },
    {
      name: 'evaluar_fechas_y_calendarios',
      description: 'Evalúa si al alumno le conviene el calendario 26B (Examen Mayo) o 27A (Examen Noviembre) basándose en su mes de examen.',
      inputSchema: {
        type: 'object',
        properties: {
          mes_examen: { type: 'string', description: 'Mes en que el alumno hará su examen de admisión.' }
        },
        required: ['mes_examen']
      }
    }
  ]
}));

// Lógica de las Herramientas
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'obtener_ruta_y_curso_ideal') {
    const { data: univData } = await supabase.from('universidades').select('*').ilike('nombre_universidad', `%${args.universidad}%`).limit(1);
    const { data: carrData } = await supabase.from('mapeo_carreras').select('*').ilike('carrera', `%${args.carrera}%`).limit(1);
    
    let respuesta = `Resultados del análisis:\n`;
    if (univData && univData.length > 0) {
      respuesta += `- Examen requerido: ${univData[0].examen_que_aplica}\n- Meses de examen: ${univData[0].mes_examen_principal} y ${univData[0].mes_examen_secundario || 'N/A'}\n`;
    } else {
      respuesta += `- No se encontró la universidad en la base de datos.\n`;
    }

    if (carrData && carrData.length > 0) {
      respuesta += `- Para la carrera de ${carrData[0].carrera}, el curso recomendado es el: ${carrData[0].curso_recomendado}\n`;
    } else {
      respuesta += `- No se encontró la carrera exacta, pregunta al alumno a qué área pertenece para recomendar el curso.\n`;
    }
    return { toolResult: respuesta };
  }

  if (name === 'consultar_info_y_precios_curso') {
    const { data: cursoData } = await supabase.from('catalogo_cursos')
      .select('*')
      .ilike('nombre_curso', `%${args.nombre_curso}%`)
      .ilike('modalidad', `%${args.modalidad}%`)
      .ilike('calendario', `%${args.calendario}%`)
      .limit(1);

    if (cursoData && cursoData.length > 0) {
      const c = cursoData[0];
      return { toolResult: `Info del Curso:\nEstatus: ${c.estatus}\nFechas: Inicia ${c.fecha_inicio}, Termina ${c.fecha_fin}\nHorarios: ${c.horarios}\nPrecio Lista: $${c.precio_lista}\nPrecio Descuento: $${c.precio_descuento} (Válido hasta ${c.vigencia_descuento})\nApartado: $${c.pago_apartado}\nLink: ${c.link_pago}\nIncluye:\n${c.descripcion_corta}` };
    }
    return { toolResult: `No se encontró un curso activo con esos parámetros exactos. Verifica modalidad o calendario.` };
  }

  if (name === 'evaluar_fechas_y_calendarios') {
    const mes = args.mes_examen.toLowerCase();
    if (['mayo', 'abril', 'junio', 'julio'].includes(mes)) {
      return { toolResult: `El alumno hace examen pronto. Debes recomendarle cursos del calendario actual: 26B.` };
    } else if (['noviembre', 'octubre', 'diciembre'].includes(mes)) {
      return { toolResult: `El alumno tiene tiempo. Debes recomendarle la PREVENTA del calendario: 27A (tiene 50% de descuento).` };
    } else {
      return { toolResult: `El mes indicado no cuadra con los calendarios principales. Sugiere la Membresía On-Demand para estudiar a su propio ritmo.` };
    }
  }

  throw new Error('Herramienta no encontrada');
});

// Configurar rutas SSE para el MCP (Para que CBB se conecte)
let transport;
app.get('/sse', async (req, res) => {
  transport = new SSEServerTransport('/messages', res);
  await mcpServer.connect(transport);
});

app.post('/messages', async (req, res) => {
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send('No hay conexión SSE activa');
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor MCP de UNX corriendo en el puerto ${PORT}`);
});

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import type { TaskOutcome } from '../src/tasks/task';
import type {
  TaskExecutionInput,
  TaskExecutor,
} from '../src/tasks/task-executor';
import { TaskRunner } from '../src/tasks/task-runner';
import { TASK_EXECUTOR } from '../src/tasks/tasks.constants';

const TOKEN = process.env.AGENT_API_TOKEN as string;
const auth = { Authorization: `Bearer ${TOKEN}` };
const PASSWORD = 'desk-secret-pw';
const body = (url = 'wss://desk.example/websockify') => ({
  tarea: 'Registra al cliente Papelería Los Andes, NIT 901234567.',
  escritorio: { url, password: PASSWORD },
});

/** Ejecutor controlable: cada tarea queda pendiente hasta que el test la resuelve. */
class ControlledExecutor implements TaskExecutor {
  readonly pending = new Map<string, (o: TaskOutcome) => void>();
  readonly inputs: TaskExecutionInput[] = [];
  execute(input: TaskExecutionInput): Promise<TaskOutcome> {
    this.inputs.push(input);
    return new Promise((resolve) => this.pending.set(input.taskId, resolve));
  }
}

describe('API de tareas (e2e)', () => {
  let app: INestApplication<App>;
  let executor: ControlledExecutor;
  let http: ReturnType<typeof request>;

  beforeEach(async () => {
    executor = new ControlledExecutor();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TASK_EXECUTOR)
      .useValue(executor)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    http = request(app.getHttpServer());
  });

  afterEach(async () => {
    for (const resolve of executor.pending.values())
      resolve({ estado: 'fallida', resumen: 'fin del test' });
    await app.get(TaskRunner).drain();
    await app.close();
  });

  /** Resuelve las tareas indicadas y espera a que se persistan (drain espera a todas las activas). */
  const finish = async (ids: string | string[], outcome: TaskOutcome) => {
    for (const id of [ids].flat()) executor.pending.get(id)?.(outcome);
    await app.get(TaskRunner).drain();
  };

  describe('GET /health', () => {
    it('200 sin token (abierto)', () =>
      http.get('/health').expect(200, { status: 'ok' }));
    it('200 también con token', () =>
      http.get('/health').set(auth).expect(200));
  });

  describe('autenticación Bearer', () => {
    it.each([
      ['sin cabecera', {}],
      ['token erróneo', { Authorization: 'Bearer otro-token-cualquiera' }],
      ['esquema erróneo', { Authorization: `Basic ${TOKEN}` }],
    ])('401 UNAUTHORIZED: %s', async (_c, headers: Record<string, string>) => {
      const res = await http
        .post('/tasks')
        .set(headers)
        .send(body())
        .expect(401);
      expect(res.body).toEqual({
        code: 'UNAUTHORIZED',
        message: 'Token Bearer ausente o inválido',
      });
      expect(executor.inputs).toHaveLength(0);
    });

    it('401 también en GET /tasks/:id', () => http.get('/tasks/x').expect(401));
  });

  describe('POST /tasks', () => {
    it('200 con {"task_id"} exacto en menos de 2 s y estado en_curso', async () => {
      const t0 = performance.now();
      const res = await http.post('/tasks').set(auth).send(body()).expect(200);
      expect(performance.now() - t0).toBeLessThan(2_000);
      expect(Object.keys(res.body as object)).toEqual(['task_id']);
      const id = (res.body as { task_id: string }).task_id;
      await http
        .get(`/tasks/${id}`)
        .set(auth)
        .expect(200, { estado: 'en_curso', resumen: 'Ejecutando tarea.' });
      expect(executor.inputs[0]).toEqual({
        taskId: id,
        instruction: body().tarea,
        desktop: body().escritorio,
      });
    });

    it('el resultado terminal se publica redactado y sin otros campos', async () => {
      const { body: created } = await http
        .post('/tasks')
        .set(auth)
        .send(body())
        .expect(200);
      const id = (created as { task_id: string }).task_id;
      await finish(id, {
        estado: 'terminada',
        resumen: `respuesta: 45 (clave ${PASSWORD})`,
      });
      const res = await http.get(`/tasks/${id}`).set(auth).expect(200);
      expect(res.body).toEqual({
        estado: 'terminada',
        resumen: 'respuesta: 45 (clave ***)',
      });
    });

    it('409 DESKTOP_BUSY si el escritorio ya tiene tarea activa; libre al terminar', async () => {
      const { body: first } = await http
        .post('/tasks')
        .set(auth)
        .send(body())
        .expect(200);
      const busy = await http
        .post('/tasks')
        .set(auth)
        .send(body('wss://DESK.example/websockify/'))
        .expect(409);
      expect(busy.body).toEqual({
        code: 'DESKTOP_BUSY',
        message: 'El escritorio ya tiene una tarea en curso',
      });
      const { body: other } = await http
        .post('/tasks')
        .set(auth)
        .send(body('wss://otro.example/websockify'))
        .expect(200);
      const ids = [first, other].map((b) => (b as { task_id: string }).task_id);
      await finish(ids, { estado: 'fallida', resumen: 'x' });
      await http.post('/tasks').set(auth).send(body()).expect(200);
    });

    it.each([
      [
        'sin tarea',
        { escritorio: { url: 'wss://d/websockify', password: PASSWORD } },
      ],
      [
        'tarea vacía',
        {
          tarea: '',
          escritorio: { url: 'wss://d/websockify', password: PASSWORD },
        },
      ],
      ['sin escritorio', { tarea: 'x' }],
      [
        'url http',
        {
          tarea: 'x',
          escritorio: { url: 'http://d/websockify', password: PASSWORD },
        },
      ],
      [
        'sin password',
        { tarea: 'x', escritorio: { url: 'wss://d/websockify' } },
      ],
      ['campo extra', { ...body(), extra: 1 }],
      [
        'campo extra anidado',
        {
          tarea: 'x',
          escritorio: {
            url: 'wss://d/websockify',
            password: PASSWORD,
            user: 'u',
          },
        },
      ],
    ])(
      '400 VALIDATION_ERROR: %s, sin devolver valores',
      async (_c, payload) => {
        const res = await http
          .post('/tasks')
          .set(auth)
          .send(payload)
          .expect(400);
        expect(res.body).toMatchObject({
          code: 'VALIDATION_ERROR',
          message: 'El cuerpo de la petición no es válido',
        });
        expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
        expect(executor.inputs).toHaveLength(0);
      },
    );

    it('400 con JSON mal formado, en el envelope', async () => {
      const res = await http
        .post('/tasks')
        .set(auth)
        .set('Content-Type', 'application/json')
        .send('{"tarea":')
        .expect(400);
      expect(res.body).toMatchObject({
        code: expect.any(String),
        message: expect.any(String),
      });
    });
  });

  describe('GET /tasks/:id', () => {
    it('404 TASK_NOT_FOUND si no existe', () =>
      http.get('/tasks/no-existe').set(auth).expect(404, {
        code: 'TASK_NOT_FOUND',
        message: 'No existe la tarea',
      }));
  });

  it('ruta desconocida → 404 en el envelope', async () => {
    const res = await http.get('/nada').set(auth).expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });
});

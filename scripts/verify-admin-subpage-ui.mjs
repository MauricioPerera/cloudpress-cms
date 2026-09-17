import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'acorn';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const css = await read('admin-subpage.css');
for (const token of ['--blue:#2271b1', '--nav:#1d2327', '--page:#f0f0f1', 'grid-template-columns:248px', '@media(max-width:850px)', ':focus-visible']) assert.ok(css.includes(token), `Falta token o comportamiento: ${token}`);
assert.ok(css.includes('grid-template-rows:auto 40px auto'), 'Los campos deben reservar filas alineadas para etiqueta, control y ayuda');
for (const [file, selectors] of Object.entries({
  'roles.html': ['admin-subpage.css', 'class="shell"', 'class="sidebar"', 'id="role-form"', 'id="roles"', 'resource-list'],
  'content-types.html': ['admin-subpage.css', 'class="shell"', 'class="sidebar"', 'id="form"', 'id="list"', 'resource-list']
})) {
  const html = await read(file);
  for (const selector of selectors) assert.ok(html.includes(selector), `${file} debe conservar ${selector}`);
}
const navigation = await read('roles-nav.js');
assert.ok(navigation.includes('"/content-types.html"'), 'El inyector global debe ignorar las subpáginas con navegación propia');
assert.ok(navigation.includes('"/wp-admin.html"'), 'El shell estándar no debe recibir entradas duplicadas');
const redirect = await read('admin-subpage.js');
assert.ok(redirect.includes('wp-admin.html?view='), 'Una subpágina abierta directamente debe volver al shell administrativo');
const shell = await read('wp-admin.html');
assert.ok(shell.includes("roles:['/roles.html'"), 'Roles debe abrirse dentro del shell administrativo real');
assert.ok(shell.includes("'content-types':['/content-types.html'"), 'Tipos de contenido debe abrirse dentro del shell administrativo real');
assert.ok(shell.includes('contextualActions'), 'La acción superior debe depender de la vista actual');
assert.ok(shell.includes("r[0].includes('?')?'&':'?'"), 'El shell debe preservar los parámetros de las vistas de agentes');
const agentNavigation = await read('agent-operations-navigation.js');
for (const view of ['agent-overview', 'agent-tasks', 'agent-profiles', 'agent-models']) assert.ok(agentNavigation.includes(view), `La barra lateral debe incluir ${view}`);
const agentOperations = await read('agent-operations.html');
assert.ok(agentOperations.includes('agent-operations-views.js'), 'La consola debe cargar el selector de vistas');
for (const token of ['data-admin-view="agent-operations"', 'admin-subpage.css', 'class="shell"', 'class="sidebar"', 'class="topbar"', 'class="content"', 'set_profile_status', 'Revocar perfil', 'cloudpress_restore_content', 'cloudpress_upload_media', 'cloudpress_update_media_meta', 'agent-observability', 'Catálogo de modelos', 'maxModelCostMicrounits', 'upsert_model']) assert.ok(agentOperations.includes(token), `La consola de agentes debe incluir ${token}`);
for (const [, source] of agentOperations.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)) parse(source, { ecmaVersion: 'latest' });
const agentViews = await read('agent-operations-views.js');
for (const view of ['overview', 'tasks', 'profiles', 'models']) assert.ok(agentViews.includes(view), `La consola debe exponer la vista ${view}`);
parse(agentViews, { ecmaVersion: 'latest' });
console.log('UI administrativa de Roles, Tipos de contenido y Agentes verificada.');

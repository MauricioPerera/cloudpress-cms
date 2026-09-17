import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
console.log('UI administrativa de Roles y Tipos de contenido verificada.');

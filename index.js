const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');
const fse = require('fs-extra');
const ignore = require('ignore');
const { Octokit } = require('@octokit/rest');
require('dotenv').config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

/**
 * Copia recursiva srcDir → destDir
 * - Omite carpetas y archivos listados en cualquier .gitignore
 * - Omite completamente cualquier carpeta llamada .git
 * - Omite enlaces simbólicos
 */
async function copyWithAllIgnores(srcDir, destDir, ancestorsIg = []) {
    // 1) Leer .gitignore local y crear parser
    let localIg;
    const gi = path.join(srcDir, '.gitignore');
    if (fs.existsSync(gi)) {
        const txt = fs.readFileSync(gi, 'utf8');
        localIg = ignore().add(
            txt.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
        );
    }
    const parsers = localIg ? [...ancestorsIg, { root: srcDir, ig: localIg }] : ancestorsIg;

    // 2) Asegurar destino
    await fse.ensureDir(destDir);

    // 3) Recorrer entradas
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const name = entry.name;
        const srcPath = path.join(srcDir, name);
        const destPath = path.join(destDir, name);

        // 4) Nunca copiar .git
        if (name === '.git') continue;

        // 5) Omitir symlinks
        if (fs.lstatSync(srcPath).isSymbolicLink()) continue;

        // 6) Aplicar todos los parsers de .gitignore encontrados
        let skip = false;
        for (const { root, ig } of parsers) {
            const rel = path.relative(root, srcPath).split(path.sep).join('/');
            if (!rel.startsWith('..') && ig.ignores(rel)) {
                skip = true;
                break;
            }
        }
        if (skip) continue;

        // 7) Recursión o copia de archivo
        if (entry.isDirectory()) {
            await copyWithAllIgnores(srcPath, destPath, parsers);
        } else if (entry.isFile()) {
            await fse.copy(srcPath, destPath, { overwrite: true, errorOnExist: false });
        }
    }
}

/**
 * Elimina en destDir todos los archivos/carpetas que NO existen en srcDir,
 * respetando los .gitignore aplicables (i.e. mismos parsers que en copyWithAllIgnores).
 */
async function deleteExtraneous(srcDir, destDir, ancestorsIg = []) {
    // 1) Leer .gitignore local y crear parser
    let localIg;
    const gi = path.join(srcDir, '.gitignore');
    if (fs.existsSync(gi)) {
        const txt = fs.readFileSync(gi, 'utf8');
        localIg = ignore().add(
            txt.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
        );
    }
    const parsers = localIg ? [...ancestorsIg, { root: srcDir, ig: localIg }] : ancestorsIg;

    // 2) Si no existe destDir, nada que borrar
    if (!fs.existsSync(destDir)) return;

    // 3) Recorremos destDir
    for (const entry of fs.readdirSync(destDir, { withFileTypes: true })) {
        const name = entry.name;
        const srcPath = path.join(srcDir, name);
        const destPath = path.join(destDir, name);

        // 4) Nunca tocar .git
        if (name === '.git') continue;

        // 5) Aplicar .gitignore: si está ignorado en origen, no lo tocamos
        let skip = false;
        for (const { root, ig } of parsers) {
            const rel = path.relative(root, srcPath).split(path.sep).join('/');
            if (!rel.startsWith('..') && ig.ignores(rel)) {
                skip = true;
                break;
            }
        }
        if (skip) continue;

        // 6) Si NO existe en src, lo borramos
        if (!fs.existsSync(srcPath)) {
            await fse.remove(destPath);
            console.log(`🗑️  Eliminado en copia: ${destPath}`);
        }
        // 7) Si existe y es directorio, recursión
        else if (entry.isDirectory()) {
            await deleteExtraneous(srcPath, destPath, parsers);
        }
    }
}

/**
 * Descarta todos los cambios locales en un repo Git:
 *  - git reset --hard
 *  - git clean -fd
 */
function discardLocalChanges(repoPath) {
    try {
        execSync('git reset --hard', { cwd: repoPath, stdio: 'ignore' });
        execSync('git clean -fd', { cwd: repoPath, stdio: 'ignore' });
        console.log('✅ Cambios locales descartados en copia');
    } catch (err) {
        console.error('⚠️ Error al descartar cambios locales:', err.message);
    }
}

/**
 * Hace commit con mensaje genérico y push a la rama main
 */
function commitAndPush(repoPath, message = 'Sync desde principal') {
    try {
        execSync('git add .', { cwd: repoPath });
        execSync(`git commit -m "${message}"`, { cwd: repoPath });
        execSync('git push origin HEAD:main', { cwd: repoPath, stdio: 'inherit' });
        console.log('🔗 Push completado desde copia');
    } catch (err) {
        if (/nothing to commit/.test(err.message)) {
            console.log('ℹ️ No había cambios para commitear');
        } else {
            console.error('⚠️ Error en commit/push:', err.message);
        }
    }
}

/**
 * Sincroniza src → dest SIN BORRAR NADA:
 * solo copia encima lo no ignorado.
 */
async function syncDirs(src, dest, deleteExtraneous = false) {
    // 1) Copiamos todo lo no ignorado (como ya tienes)
    await copyWithAllIgnores(src, dest);
    if (!deleteExtraneous) return;
    // 2) Borramos en dest lo que ya no está en src
    await deleteExtraneous(src, dest);
}


async function uploadToGitHub(destPath, projectName) {
    try {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
            console.error('❌ Define GITHUB_TOKEN con scope `repo`.');
            return;
        }
        const octokit = new Octokit({ auth: token });
        const { data: user } = await octokit.rest.users.getAuthenticated();
        const defaultName = projectName;
        const inp = await askQuestion(`Nombre del repo (por defecto '${defaultName}'): `);
        const repoName = inp.trim() || defaultName;

        await octokit.rest.repos.createForAuthenticatedUser({ name: repoName, private: true });
        console.log(`✅ Repo '${repoName}' creado bajo ${user.login}`);

        const plain = `https://github.com/${user.login}/${repoName}.git`;
        const auth = `https://${token}@github.com/${user.login}/${repoName}.git`;
        const cwd = destPath;

        execSync('git init', { cwd });
        execSync('git add .', { cwd });
        execSync('git commit -m "Initial commit"', { cwd });
        execSync('git remote remove origin || true', { cwd, stdio: 'ignore' });
        execSync(`git remote add origin ${auth}`, { cwd });
        execSync('git push -u origin HEAD:main', { cwd, stdio: 'inherit' });

        console.log(`🔗 Push completado a ${plain}`);
    } catch (e) {
        console.error('Error al subir a GitHub:', e.message);
    }
}

async function showMenu(projPath, destProjPath) {
    let bg = null;
    while (true) {
        console.log('\n--- Menú Principal ---');
        console.log('1. Sincronizar principal → copia una vez');
        console.log('2. Sincronizar principal → copia con descartar cambios locales + push');
        console.log('3. Sincronizar copia → principal una vez');
        console.log('4. Delete extraneous en copia (sin sincronizar)');
        const opt = (await askQuestion('Selecciona una opción: ')).trim();

        switch (opt) {
            case '1':
                await syncDirs(projPath, destProjPath, true);
                console.log('✅ Sync principal→copia');
                break;
            case '2':
                discardLocalChanges(destProjPath);
                await syncDirs(projPath, destProjPath, true);
                console.log('✅ Sync principal→copia completado');
                commitAndPush(destProjPath, 'Sincronización automática desde principal');
                break;
            case '3':
                await syncDirs(destProjPath, projPath);
                console.log('✅ Sync copia→principal');
                break;
            case '4':
                await deleteExtraneous(destProjPath, destProjPath);
                console.log('✅ Extraneous borrados en copia');
                break;
            default:
                console.log('Opción inválida');
        }
    }
}

async function main() {
    try {
        const projectPath = process.env.PROJECT_PATH
            ? process.env.PROJECT_PATH
            : (await askQuestion('Ruta proyecto: ')).trim();
        const baseDest = process.env.DESTINATION_PATH
            ? process.env.DESTINATION_PATH
            : (await askQuestion('Ruta destino copia: ')).trim();

        // Evitar rutas idénticas
        const destProjectPath = path.join(baseDest, path.basename(projectPath));
        if (path.resolve(projectPath) === path.resolve(destProjectPath)) {
            console.error('❌ Origen y destino no pueden ser iguales.');
            rl.close();
            return;
        }

        process.env.PROJECT_ROOT = projectPath;

        if (!fs.existsSync(destProjectPath)) {
            console.log('📋 Copiando proyecto inicial...');
            await copyWithAllIgnores(projectPath, destProjectPath);
            console.log('✅ Proyecto copiado!');
            const up = (await askQuestion('¿Crear y subir repo a GitHub? (s/n): ')).trim().toLowerCase();
            if (up === 's') await uploadToGitHub(destProjectPath, path.basename(projectPath));
        } else {
            console.log('ℹ️ Proyecto ya existe en destino.');
        }

        await showMenu(projectPath, destProjectPath);
    } catch (err) {
        console.error('Error:', err.message);
        rl.close();
    }
}

main();

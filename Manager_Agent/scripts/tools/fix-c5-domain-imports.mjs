/** Fix graph/utils import depth in core/{domain}/ after C5 bulk migration */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const coreDir = path.join(root, 'server/graph/core')
const domains = fs.readdirSync(coreDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)

/** mod basename → domain dir */
const modDomain = new Map()
for (const d of domains) {
  const dir = path.join(coreDir, d)
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.ts') && f !== 'index.ts') modDomain.set(f.replace(/\.ts$/, ''), d)
  }
}

function fixFile(p, domain) {
  const raw = fs.readFileSync(p, 'utf8')
  let next = raw
  // graph 层：core/{domain}/ → ../../
  for (const layer of ['llm', 'orchestrate', 'state', 'nodes']) {
    next = next.replace(new RegExp(`from (['"])\\.\\./${layer}/`, 'g'), `from $1../../${layer}/`)
    next = next.replace(new RegExp(`import\\((['"])\\.\\./${layer}/`, 'g'), `import($1../../${layer}/`)
  }
  // server/utils：core/{domain}/ → ../../../utils/
  next = next.replace(/from (['"])\.\.\/\.\.\/utils\//g, "from $1../../../utils/")
  next = next.replace(/import\((['"])\.\.\/\.\.\/utils\//g, "import($1../../../utils/")
  // Manager_Agent/shared
  next = next.replace(/from (['"])\.\.\/\.\.\/\.\.\/shared\//g, "from $1../../../../shared/")
  next = next.replace(/import\((['"])\.\.\/\.\.\/\.\.\/shared\//g, "import($1../../../../shared/")
  // 同域/跨域 managerGraph.* 相对引用
  next = next.replace(
    /from (['"])\.\.\/managerGraph\.([a-zA-Z0-9_]+)(?:\.ts)?(['"])/g,
    (_m, q1, mod, q2) => {
      const target = modDomain.get(mod)
      if (!target) return `from ${q1}../managerGraph.${mod}${q2}`
      if (target === domain) return `from ${q1}./${mod}${q2}`
      return `from ${q1}../${target}/${mod}${q2}`
    }
  )
  next = next.replace(
    /import\((['"])\.\.\/managerGraph\.([a-zA-Z0-9_]+)(?:\.ts)?(['"])\)/g,
    (_m, q1, mod, q2) => {
      const target = modDomain.get(mod)
      if (!target) return `import(${q1}../managerGraph.${mod}${q2})`
      if (target === domain) return `import(${q1}./${mod}${q2})`
      return `import(${q1}../${target}/${mod}${q2})`
    }
  )
  return next
}

let fixed = 0
for (const d of domains) {
  const dir = path.join(coreDir, d)
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue
    const p = path.join(dir, f)
    const next = fixFile(p, d)
    if (next !== fs.readFileSync(p, 'utf8')) {
      fs.writeFileSync(p, next, 'utf8')
      fixed++
      console.log('fixed:', path.relative(process.cwd(), p))
    }
  }
}
console.log(`Done. fixed=${fixed}`)

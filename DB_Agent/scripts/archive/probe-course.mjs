import mysql from "mysql2/promise";

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "123456",
  database: process.env.MYSQL_DATABASE || "p2026",
});

const [tables] = await c.query(
  `SELECT table_name, table_comment FROM information_schema.tables 
   WHERE table_schema=DATABASE() AND (table_name LIKE '%course%' OR table_comment LIKE '%课程%')`,
);
console.log("course tables:", tables);

const [cols] = await c.query(
  `SELECT table_name, column_name, column_comment, data_type FROM information_schema.columns 
   WHERE table_schema=DATABASE() AND column_name IN ('course_name','arr_problem_id','problem_name')`,
);
console.log("key cols:", cols);

for (const t of tables) {
  const tn = t.TABLE_NAME || t.table_name;
  try {
    const [rows] = await c.query(
      `SELECT * FROM \`${tn}\` WHERE course_name LIKE '%测试课程%' LIMIT 1`,
    );
    if (rows.length) console.log("hit", tn, JSON.stringify(rows[0]).slice(0, 500));
  } catch {
    /* no course_name */
  }
}

const [banks] = await c.query(`
SELECT DISTINCT pi.problem_name
FROM teaching_course_info c
JOIN JSON_TABLE(CAST(c.arr_problem_id AS JSON), '$[*]' COLUMNS (pid BIGINT PATH '$')) jt
JOIN teaching_problem_info pi ON pi.id = jt.pid
WHERE c.course_name LIKE '%测试课程%'
LIMIT 10
`);
console.log("expected banks (if teaching_course_info):", banks);

await c.end();

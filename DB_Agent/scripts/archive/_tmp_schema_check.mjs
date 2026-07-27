import mysql from "mysql2/promise";

const c = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "host.docker.internal",
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "123456",
  database: process.env.MYSQL_DATABASE || "p2026",
});

const [rows1] = await c.query(
  "SELECT exam_name, total_score, arr_problem_id FROM teaching_exam_info WHERE exam_name LIKE '%农娜%' LIMIT 1",
);
console.log("exam:", JSON.stringify(rows1[0], null, 2));

const [rows2] = await c.query(`
SELECT DISTINCT pi.problem_name
FROM teaching_exam_info e
JOIN JSON_TABLE(CAST(e.arr_problem_id AS JSON), '$[*]' COLUMNS (pid BIGINT PATH '$')) jt
JOIN teaching_problem_info pi ON pi.id = jt.pid
WHERE e.exam_name LIKE '%农娜%'
LIMIT 10
`);
console.log("banks:", rows2);

await c.end();

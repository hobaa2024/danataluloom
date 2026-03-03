<?php
/**
 * Dana Al-Oloom - Diagnostic Tool
 * Checks database structure and data integrity
 */

header('Content-Type: application/json');

$db_host = 'localhost';
$db_name = 'u642507810_danat_db';
$db_user = 'u642507810_admin_user';
$db_pass = 'Danat@@124$$$##';

try {
    $pdo = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8mb4", $db_user, $db_pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    $report = [];

    // 1. Check Student Table Columns
    $stmt = $pdo->query("SHOW COLUMNS FROM students");
    $report['students_table'] = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 2. Check Data Integrity (Check for null JSON)
    $stmt = $pdo->query("SELECT id, studentName, LENGTH(data) as data_size, data FROM students");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $integrity = [];
    foreach ($rows as $r) {
        $decoded = json_decode($r['data']);
        $integrity[] = [
            'id' => $r['id'],
            'name' => $r['studentName'],
            'size' => $r['data_size'],
            'valid_json' => ($decoded !== null),
            'json_error' => json_last_error_msg()
        ];
    }
    $report['student_integrity'] = $integrity;

    // 3. Fix Table if columns are too small (Self-Healing)
    $pdo->exec("ALTER TABLE students MODIFY COLUMN data LONGTEXT");
    $pdo->exec("ALTER TABLE templates MODIFY COLUMN data LONGTEXT");
    $report['fix_applied'] = "Altered columns to LONGTEXT";

    echo json_encode($report, JSON_PRETTY_PRINT);

} catch (Exception $e) {
    echo json_encode(['error' => $e.getMessage()]);
}

<?php
/**
 * Dana Al-Oloom School - FINAL STABLE API
 * Supports immediate cloud authentication for new devices
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit(0); }

// --- NO-CACHE HEADERS (Force devices to see fresh data) ---
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");

// --- DATABASE CONFIGURATION ---
$db_host = 'localhost';
$db_name = 'u642507810_danat_db';
$db_user = 'u642507810_admin_user';
$db_pass = 'Danat@@124$$$##';

try {
    $pdo = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8mb4", $db_user, $db_pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => 'Connection failed']);
    exit;
}

// 1. Bulletproof Key Retrieval (Handles various server configurations)
function get_api_key() {
    if (isset($_GET['key'])) return $_GET['key'];     // Match with JS 'key'
    if (isset($_POST['key'])) return $_POST['key'];   // Match with JS 'key'
    if (isset($_SERVER['HTTP_X_API_KEY'])) return $_SERVER['HTTP_X_API_KEY'];
    if (isset($_GET['api_key'])) return $_GET['api_key'];
    if (isset($_REQUEST['api_key'])) return $_REQUEST['api_key'];
    
    $headers = function_exists('getallheaders') ? array_change_key_case(getallheaders(), CASE_LOWER) : [];
    return $headers['x-api-key'] ?? null;
}

$key = get_api_key();
$MASTER_KEY = 'DANAT2026'; // Simplified key for easier server passing

$isAuthorized = ($key === $MASTER_KEY);

// Fallback: Check cloud password
if (!$isAuthorized && $key) {
    $stmt = $pdo->query("SELECT s_value FROM settings WHERE s_key = 'appSettings'");
    $s = $stmt->fetch();
    $sett = $s ? json_decode($s['s_value'], true) : ['adminUsername'=>'admin', 'adminPassword'=>'admin'];
    $parts = explode(':', $key);
    if (count($parts) === 2) {
        $isAuthorized = ($parts[0] === $sett['adminUsername'] && $parts[1] === $sett['adminPassword']);
    }
}

// Public/Student access for contract signing and submission
if (!$isAuthorized && ($_GET['action'] === 'get_student' || $_GET['action'] === 'update_contract')) {
    $isAuthorized = true; // Limited read/update access allowed for signing
}

if (!$isAuthorized) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Unauthorized Access']);
    exit;
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'save_student':
        $data = json_decode(file_get_contents('php://input'), true);
        if (!$data) exit(json_encode(['success' => false]));
        $stmt = $pdo->prepare("REPLACE INTO students (id, studentName, studentLevel, studentGrade, parentName, parentEmail, parentWhatsapp, contractYear, contractStatus, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$data['id'], $data['studentName']??'', $data['studentLevel']??'', $data['studentGrade']??'', $data['parentName']??'', $data['parentEmail']??'', $data['parentWhatsapp']??'', $data['contractYear']??'', $data['contractStatus']??'pending', json_encode($data)]);
        echo json_encode(['success' => true]);
        break;

    case 'get_students':
        $stmt = $pdo->query("SELECT data FROM students");
        $results = $stmt->fetchAll();
        echo json_encode(array_map(function($r) { return json_decode($r['data'], true); }, $results));
        break;

    case 'get_student':
        $id = $_GET['id'] ?? '';
        $stmt = $pdo->prepare("SELECT data FROM students WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        echo json_encode($row ? json_decode($row['data'], true) : null);
        break;

    case 'delete_student':
        $id = $_GET['id'] ?? '';
        $stmt = $pdo->prepare("DELETE FROM students WHERE id = ?");
        $stmt->execute([$id]);
        echo json_encode(['success' => true]);
        break;

    case 'update_contract':
        $id = $_GET['id'] ?? '';
        $data = json_decode(file_get_contents('php://input'), true);
        if (!$id || !$data) exit(json_encode(['success' => false]));
        
        // UPSERT: Update if exists, Insert if not. 
        // This ensures the signature is saved even if the initial record hasn't sync'd yet.
        $stmt = $pdo->prepare("SELECT data FROM students WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        
        $student = $row ? json_decode($row['data'], true) : $data;
        if ($row) {
            foreach ($data as $k => $v) { $student[$k] = $v; }
        }
        
        // Use incoming status if provided, otherwise default to 'signed'
        $newStatus = $data['contractStatus'] ?? ($student['contractStatus'] ?? 'signed');
        $student['contractStatus'] = $newStatus;
        
        $stmt = $pdo->prepare("REPLACE INTO students (id, studentName, studentLevel, studentGrade, parentName, parentEmail, parentWhatsapp, contractYear, contractStatus, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([
            $id, 
            $student['studentName']??'', 
            $student['studentLevel']??'', 
            $student['studentGrade']??'', 
            $student['parentName']??'', 
            $student['parentEmail']??'', 
            $student['parentWhatsapp']??'', 
            $student['contractYear']??'', 
            $newStatus, // Use the correct status (signed or verified)
            json_encode($student)
        ]);
        echo json_encode(['success' => true]);
        break;

    case 'save_settings':
        $data = json_decode(file_get_contents('php://input'), true);
        $stmt = $pdo->prepare("REPLACE INTO settings (s_key, s_value) VALUES ('appSettings', ?)");
        $stmt->execute([json_encode($data)]);
        echo json_encode(['success' => true]);
        break;

    case 'get_settings':
        $stmt = $pdo->query("SELECT s_value FROM settings WHERE s_key = 'appSettings'");
        $row = $stmt->fetch();
        echo $row ? $row['s_value'] : json_encode(new stdClass());
        break;

    case 'save_template':
        $data = json_decode(file_get_contents('php://input'), true);
        $stmt = $pdo->prepare("REPLACE INTO templates (id, title, type, data) VALUES (?, ?, ?, ?)");
        $stmt->execute([$data['id'], $data['title']??'', $data['type']??'text', json_encode($data)]);
        echo json_encode(['success' => true]);
        break;

    case 'get_templates':
        $stmt = $pdo->query("SELECT data FROM templates");
        $results = $stmt->fetchAll();
        echo json_encode(array_map(function($r) { return json_decode($r['data'], true); }, $results));
        break;

    case 'delete_template':
        $id = $_GET['id'] ?? '';
        $stmt = $pdo->prepare("DELETE FROM templates WHERE id = ?");
        $stmt->execute([$id]);
        echo json_encode(['success' => true]);
        break;

    default:
        echo json_encode(['success' => false, 'error' => 'Unknown action']);
}

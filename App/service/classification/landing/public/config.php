<?php

header("Content-Type: application/json; charset=utf-8");

try {
    $pdo = new PDO(
        "mysql:host=localhost;dbname=dexmin;charset=utf8mb4",
        getenv("root"),
        getenv("aldo"),
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]
    );

    $resource = $_GET["resource"] ?? "";

    if ($_SERVER["REQUEST_METHOD"] === "GET"
        && $resource === "failures") {

        $stmt = $pdo->query(
            "SELECT id, failure, name
             FROM failure_definitions
             ORDER BY id"
        );

        echo json_encode([
            "success" => true,
            "data" => $stmt->fetchAll()
        ]);

        exit;
    }

    http_response_code(404);

    echo json_encode([
        "success" => false,
        "message" => "Resource tidak ditemukan"
    ]);

} catch (Throwable $e) {

    error_log($e->getMessage());

    http_response_code(500);

    echo json_encode([
        "success" => false,
        "message" => "Kesalahan server"
    ]);
}
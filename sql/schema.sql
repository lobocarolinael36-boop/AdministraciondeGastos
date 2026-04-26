-- ============================================================
-- CasaFlow - Schema v1
-- ============================================================

CREATE DATABASE IF NOT EXISTS casaflow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE casaflow;

-- Hogares (una pareja o grupo comparte uno)
CREATE TABLE hogares (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Usuarios
CREATE TABLE usuarios (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  hogar_id    INT NOT NULL,
  nombre      VARCHAR(100) NOT NULL,
  telefono    VARCHAR(30) UNIQUE NOT NULL,   -- número de WhatsApp
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hogar_id) REFERENCES hogares(id)
);

-- Categorías de gastos
CREATE TABLE categorias (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(80) NOT NULL,
  icono       VARCHAR(10) DEFAULT '💰'
);

INSERT INTO categorias (nombre, icono) VALUES
  ('Luz',           '💡'),
  ('Gas',           '🔥'),
  ('Internet',      '🌐'),
  ('Teléfono',      '📱'),
  ('Alquiler',      '🏠'),
  ('Supermercado',  '🛒'),
  ('Salud',         '🏥'),
  ('Transporte',    '🚌'),
  ('Entretenimiento','🎬'),
  ('Otros',         '📦');

-- Presupuestos mensuales por hogar y categoría
CREATE TABLE presupuestos (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  hogar_id     INT NOT NULL,
  categoria_id INT NOT NULL,
  monto        DECIMAL(12,2) NOT NULL,
  mes          TINYINT NOT NULL,   -- 1-12
  anio         SMALLINT NOT NULL,
  FOREIGN KEY (hogar_id) REFERENCES hogares(id),
  FOREIGN KEY (categoria_id) REFERENCES categorias(id),
  UNIQUE KEY uq_presupuesto (hogar_id, categoria_id, mes, anio)
);

-- Gastos
CREATE TABLE gastos (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  hogar_id        INT NOT NULL,
  usuario_id      INT NOT NULL,           -- quién lo cargó / pagó
  categoria_id    INT,
  descripcion     VARCHAR(255),
  monto           DECIMAL(12,2) NOT NULL,
  es_compartido   BOOLEAN DEFAULT FALSE,  -- lo divide el hogar
  mensaje_original TEXT,                  -- texto crudo de WhatsApp
  fecha_gasto     DATE NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hogar_id) REFERENCES hogares(id),
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);

-- Recordatorios configurados por hogar
CREATE TABLE recordatorios (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  hogar_id     INT NOT NULL,
  categoria_id INT NOT NULL,
  dia_del_mes  TINYINT DEFAULT 1,   -- qué día preguntar
  activo       BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (hogar_id) REFERENCES hogares(id),
  FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);

-- Datos de ejemplo para arrancar
INSERT INTO hogares (nombre) VALUES ('Hogar Ricardo y Carolina');

INSERT INTO usuarios (hogar_id, nombre, telefono) VALUES
  (1, 'Ricardo',  '5491100000001'),
  (1, 'Carolina', '5491100000002');

INSERT INTO presupuestos (hogar_id, categoria_id, monto, mes, anio) VALUES
  (1, 1, 15000, MONTH(NOW()), YEAR(NOW())),  -- Luz
  (1, 2, 12000, MONTH(NOW()), YEAR(NOW())),  -- Gas
  (1, 3,  8000, MONTH(NOW()), YEAR(NOW())),  -- Internet
  (1, 5, 80000, MONTH(NOW()), YEAR(NOW())),  -- Alquiler
  (1, 6, 60000, MONTH(NOW()), YEAR(NOW()));  -- Supermercado

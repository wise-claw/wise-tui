ALTER TABLE employees ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;

UPDATE employees
SET display_order = created_at
WHERE display_order = 0;

CREATE INDEX IF NOT EXISTS idx_employees_display_order ON employees(display_order, created_at);

import { verbose } from "sqlite3";
import { Canvas, PNGStream } from "canvas";
import { createWriteStream } from "fs";
import Path from "path";
import fs from "fs";
const sqlite3 = verbose();
let dbFile = process.argv[2];

if (!dbFile) {
  console.error("No SQLite database file specified");
  console.log(`Usage: node "${process.argv[1]}" "<path/to/database.db>"`);
  process.exit(1);
}

if (!Path.isAbsolute(dbFile)) {
  dbFile = Path.resolve(process.cwd(), dbFile);
}

if (!fs.existsSync(dbFile)) {
  console.error(`File "${dbFile}" does not exist`);
  process.exit(1);
}

let db = new sqlite3.Database(dbFile);


interface ColumnData {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  _isHeader?: boolean;
}

db.all("SELECT name FROM sqlite_master WHERE type='table';", [], async (err, tables: { name: string }[]) => {
  const tableNames = tables.map((table) => table.name);
  console.log(tableNames);

  async function fetchColumnInfo() {
    const columnDetails: Record<string, ColumnData[]> = {};
    for (const tableName of tableNames) {
      await new Promise<void>((resolve) => {
        db.all(`PRAGMA table_info(${tableName});`, [], (err: Error, columns: ColumnData[]) => {
          columnDetails[tableName] = columns;
          resolve();
        });
      });
    }
    return columnDetails;
  }

  function drawTables(columnDetails: Record<string, ColumnData[]>, sizes?: {
    canvasWidth?: number;
    canvasHeight?: number;
  }): PNGStream {
    const { canvasWidth, canvasHeight } = sizes ?? {};
    const width = canvasWidth ? Math.ceil(canvasWidth) : 0
    const height = canvasHeight ? Math.ceil(canvasHeight) : Object.values(columnDetails).reduce((acc, columns) => acc + (columns.length + 3) * 20, 0) + (Object.keys(columnDetails).length * 10);
    const canvas = new Canvas(width, height);
    const ctx = canvas.getContext('2d');
    // Monospace font
    const fontFamily = "Consolas, 'Courier New', monospace";
    
    let xOffset = 10;
    let yOffset = 0;

    let needRegen = false;
    let newWidth = 0;

    
    for (const [tableName, columns] of Object.entries(columnDetails)) {
      // Create a row
      function createRow(name: string, type: string, attributes: string[]) {
        return `${name.padEnd(longestColumnNameLength)} | ${type.padEnd(longestColumnTypeLength)} | ${attributes.length ? `${attributes.join(", ")}` : ""}`;
      }

      // Add header
      if (!columns[0]?._isHeader) columns.unshift({
        cid: 0,
        name: "",
        type: "",
        notnull: 0,
        dflt_value: null,
        pk: 0,
        _isHeader: true
      });
      
      const longestColumnNameLength = (columns.slice().sort((a, b) => b.name.length - a.name.length)[0]?.name || "").length;
      const longestColumnTypeLength = (columns.slice().sort((a, b) => b.type.length - a.type.length)[0]?.type || "").length;
      const columnLines = columns.map((column) => {
        const keys: string[] = [];
        if (column.pk) keys.push("PK");
        if (column.notnull) keys.push("NOT NULL");
        // else keys.push("NULL");
        if (column.dflt_value) keys.push(`DEFAULT ${column.dflt_value}`);
        
        if (column._isHeader) return createRow("Name", "Type", ["Attributes"]);
        return createRow(column.name, column.type, keys);
      });
      
      ctx.font = `14px ${fontFamily}`;
      const longestColumn = columnLines.slice().sort((a, b) => b.length - a.length)[0];
      const tableNameLength = ctx.measureText(tableName).width;
      const longestTextLength = Math.max(tableNameLength, ctx.measureText(longestColumn || "").width);

      // New width
      const _newWidth = Math.max(tableNameLength, longestTextLength) + 40;
      if (_newWidth > canvas.width) {
        needRegen = true;
        if (newWidth < _newWidth) {
          newWidth = _newWidth;
        }
      }
      
      // Draw the table box
      const args = [xOffset - 5, yOffset, longestTextLength + 30, (columns.length + 2) * 20] as const;
      ctx.fillStyle = "#2b2b2b";
      ctx.fillRect(...args);
      ctx.strokeStyle = "white";
      ctx.strokeRect(...args);
      
      
      ctx.font = `20px ${fontFamily}`;
      // Draw the table name
      ctx.fillStyle = "#FFF";
      ctx.fillText(tableName, xOffset, yOffset + 20);

      // Draw the columns
      columnLines.forEach((line, index) => {

        // Draw the column name
        if (index === 0) {
          // Bold
          ctx.font = `bold 14px ${fontFamily}`;
          // Draw underline
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(xOffset + 10, yOffset + 50);
          ctx.lineTo(xOffset + 10 + longestTextLength, yOffset + 50);
          ctx.stroke();
          ctx.restore();
        }
        else {
          ctx.font = `14px ${fontFamily}`;
        }
        ctx.fillStyle = "#FFF";
        ctx.fillText(line, xOffset + 10, yOffset + 20 + 25 + (index * 20));
      });

      // Move yOffset down for the next table
      yOffset += (columns.length + 2) * 20 + 10;
    }

    if (needRegen) {
      return drawTables(columnDetails, {
        canvasWidth: newWidth,
        canvasHeight: height
      });
    }
    
    return canvas.createPNGStream();
  }

  const columnDetails = await fetchColumnInfo();
  console.log(columnDetails);
  const stream = drawTables(columnDetails);

  const out = createWriteStream(dbFile + ".png");
  stream.pipe(out);
  out.on("finish", () => {
    console.log(`Done! Saved to ${dbFile}.png`);
  });
});
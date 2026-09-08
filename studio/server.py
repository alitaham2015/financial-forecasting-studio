"""Loopback-only HTTP server. No external services or runtime dependencies."""
import argparse
import json
import csv
import io
import mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from .finance import calculate, InvalidScenario, ENGINE_VERSION
from .storage import Store, Conflict, blank_scenario, demo_scenario

ROOT = Path(__file__).resolve().parent.parent


def csv_report(rows):
    """Excel-compatible CSV; neutralize text cells that could be formulas."""
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    for row in rows:
        protected = []
        for value in row:
            text = str(value)
            is_number = text.lstrip('-').replace('.', '', 1).isdigit()
            if text.startswith(('=', '+', '@', '\t', '\r', '\n')) or (text.startswith('-') and not is_number):
                text = "'" + text
            protected.append(text)
        writer.writerow(protected)
    return output.getvalue().encode('utf-8-sig')


def make_handler(store):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ForecastStudio/1.0"

        def log_message(self, fmt, *args):
            # No financial assumptions, query strings, or payloads in logs.
            pass

        def send(self, status, payload, content_type="application/json; charset=utf-8", attachment=None):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if isinstance(payload, (dict, list)) else payload
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
            if attachment:
                self.send_header("Content-Disposition", f'attachment; filename="{attachment}"')
            self.end_headers()
            self.wfile.write(body)

        def dispatch(self):
            self.connection.settimeout(10)
            port = self.server.server_address[1]
            hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
            def reject(message):
                # Drain bounded request bodies before closing: an unread body
                # can make Windows reset the socket before the 403 is received.
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if 0 < length <= 8_000_000:
                        self.rfile.read(length)
                except (ValueError, OSError):
                    pass
                return self.send(403, {"message": message})
            if self.headers.get("Host") not in hosts:
                return reject("This application accepts requests from localhost only.")
            if self.command != "GET":
                if self.headers.get("Origin") not in (None, *[f"http://{host}" for host in hosts]):
                    return reject("Cross-site changes are not allowed.")
                if self.headers.get("X-Studio-Request") != "local":
                    return reject("Use the local application to change scenarios.")
            try:
                path = urlsplit(self.path).path
                body = {}
                if self.command != "GET":
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 <= length <= 8_000_000:
                        return self.send(413, {"message": "The request exceeds the 8 MB limit."})
                    if length:
                        if self.headers.get_content_type() != "application/json":
                            return self.send(415, {"message": "Use JSON for scenario changes."})
                        body = json.loads(self.rfile.read(length))
                        if not isinstance(body, dict):
                            raise ValueError("The request must contain named fields.")
                if path == "/api/health" and self.command == "GET":
                    return self.send(200, {"status": "ready", "engineVersion": ENGINE_VERSION})
                if path == "/api/scenarios":
                    if self.command == "GET":
                        return self.send(200, {"scenarios": store.list()})
                    if self.command == "POST":
                        doc = body.get("scenario") or (demo_scenario() if body.get("template") == "demo" else blank_scenario())
                        return self.send(201, {"scenario": store.create(doc)})
                if path == "/api/calculate" and self.command == "POST":
                    return self.send(200, {"result": calculate(body.get("scenario"))})
                if path == "/api/backup" and self.command == "GET":
                    return self.send(200, {"format": "financial-forecasting-studio", "version": 1, "scenarios": store.list()}, attachment="forecast-studio-backup.json")
                if path == "/api/import" and self.command == "POST":
                    if body.get("format") != "financial-forecasting-studio" or body.get("version") != 1:
                        raise ValueError("Choose a version 1 Financial Forecasting Studio JSON backup.")
                    count = store.import_many(body.get("scenarios"))
                    return self.send(200, {"imported": count})
                parts = path.strip("/").split("/")
                if len(parts) in (3, 4) and parts[:2] == ["api", "scenarios"]:
                    ident = parts[2]
                    if len(parts) == 4 and parts[3] in ("payments.csv", "balance.csv") and self.command == "GET":
                        scenario = store.get(ident)
                        result = calculate(scenario)
                        if parts[3] == "payments.csv":
                            object_id = parse_qs(urlsplit(self.path).query).get("object", [""])[0]
                            rows = [["Date", "Object", "Type", "Schedule rule", "Signed amount", "Currency", "Present value", "Discount days", "Interest", "Principal repaid", "Remaining obligation", "All-object closing cash"]]
                            rows.extend([f["date"], f["objectName"], f["type"], f["rule"], f["amount"], scenario["currency"], f["presentValue"], f["discountDays"], f.get("interest", ""), f.get("principal", ""), f.get("remaining", ""), f["closingBalance"]] for f in result["flows"] if not object_id or f["objectId"] == object_id)
                        else:
                            rows = [["Date", "Opening cash", "Inflows", "Outflows", "Net movement", "Closing cash", "Currency"]]
                            rows.extend([d["date"], d["opening"], d["inflows"], d["outflows"], d["net"], d["balance"], scenario["currency"]] for d in result["daily"])
                        return self.send(200, csv_report(rows), "text/csv; charset=utf-8", attachment="forecast-"+parts[3])
                    if len(parts) == 3:
                        if self.command == "GET":
                            return self.send(200, {"scenario": store.get(ident)})
                        if self.command == "PUT":
                            return self.send(200, {"scenario": store.save(ident, body.get("scenario"), body.get("revision"))})
                        if self.command == "DELETE":
                            store.delete(ident, body.get("revision"))
                            return self.send(200, {"deleted": True})
                    elif parts[3] == "duplicate" and self.command == "POST":
                        original = store.get(ident)
                        original["name"] = (original["name"][:110]+" · copy")
                        return self.send(201, {"scenario": store.create(original)})
                    elif parts[3] == "confirm" and self.command == "POST":
                        scenario = store.get(ident)
                        if scenario["revision"] != body.get("revision"):
                            raise Conflict("The inputs changed. Reload this scenario and review it again.")
                        result = calculate(scenario)
                        if result["warnings"] and not body.get("acceptWarnings"):
                            return self.send(409, {"message": "Accept the same-day payment-order warnings before confirming.", "warnings": result["warnings"]})
                        saved = store.confirm(ident, scenario["revision"], bool(result["warnings"]))
                        return self.send(200, {"scenario": saved, "result": result})
                if self.command == "GET" and not path.startswith("/api/"):
                    allowed = {"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/chart.js": "chart.js", "/styles.css": "styles.css", "/favicon.svg": "favicon.svg"}
                    if path in allowed:
                        file = ROOT/"web"/allowed[path]
                        content_type = {".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml"}.get(file.suffix, "application/octet-stream")
                        return self.send(200, file.read_bytes(), content_type+"; charset=utf-8")
                return self.send(404, {"message": "This page or action does not exist."})
            except InvalidScenario as exc:
                self.send(422, {"message": str(exc), "errors": exc.errors})
            except Conflict as exc:
                self.send(409, {"message": str(exc)})
            except KeyError as exc:
                self.send(404, {"message": str(exc).strip("'")})
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                self.send(400, {"message": str(exc)})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                self.send(500, {"message": "The local application could not complete this action. Your last saved scenario is preserved. Restart the application and try again."})

        do_GET = dispatch
        do_POST = dispatch
        do_PUT = dispatch
        do_DELETE = dispatch

    return Handler


def create_server(port=8765, data_dir=None):
    store = Store(Path(data_dir or ROOT/"data")/"scenarios.sqlite3")
    return ThreadingHTTPServer(("127.0.0.1", port), make_handler(store))


def main():
    parser = argparse.ArgumentParser(description="Private Financial Forecasting Studio")
    parser.add_argument("--version", action="version", version=f"%(prog)s {ENGINE_VERSION}")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path, default=ROOT/"data")
    args = parser.parse_args()
    try:
        server = create_server(args.port, args.data_dir)
    except OSError as exc:
        parser.exit(1, f"Could not start: {exc}\nIf the port is in use, open the existing application or choose --port 8766.\n")
    print(f"Financial Forecasting Studio is ready at http://127.0.0.1:{server.server_port}", flush=True)
    print(f"Private data: {args.data_dir.resolve()}\nPress Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

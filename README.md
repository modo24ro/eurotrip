# EuroTrip - Travel Itinerary & Flight Tracking Platform

EuroTrip is an interactive travel companion and itinerary planner built with Python, Flask, and modern web standards. It enables travelers to organize multi-day itineraries, track flights in real time, view travel documents (PDF boarding cards and booking confirmations) via a built-in document viewer, and explore destination locations on interactive Leaflet maps.

---

## Features

- **Interactive Daily Timeline:** Filter by days, reorder stops, view time estimates, and manage notes.
- **Flight Status Integration:** Track flight progress, arrival/departure schedules, delays, terminals, and live radar coordinates.
- **Document Viewer:** Preview travel PDFs (boarding passes, reservations, museum tickets) directly in-browser using PDF.js.
- **Interactive Maps:** Real-time routing and place exploration powered by Leaflet.js and OpenStreetMap.
- **Role-Based Access Control:** Separate admin and viewer roles with secure session tokens and password verification.
- **Version History & Backups:** Automatic version tracking with rollback capabilities.

---

## Tech Stack

- **Backend:** Python 3.11+, Flask 3.1.3, Werkzeug, Jinja2, python-dotenv
- **Frontend:** Vanilla JavaScript (ES modules), CSS3 with CSS variables, Leaflet.js, PDF.js
- **Containerization:** Docker & Docker Compose
- **Testing:** Python `unittest` suite

---

## Getting Started

### Prerequisites

- Python 3.11+
- Git

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/modo24ro/eurotrip.git
   cd eurotrip
   ```

2. **Create and activate a virtual environment:**
   ```bash
   # Linux / macOS
   python3 -m venv venv
   source venv/bin/activate

   # Windows (PowerShell)
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables:**
   Copy the example environment template:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and set your preferred secrets:
   ```dotenv
   FLASK_SECRET_KEY=your-secure-random-key
   PORT=5000
   ADMIN_PASSWORD=your-secure-admin-password
   USER_PASSWORD=your-secure-user-password
   AVIATION_KEY=your-aviationstack-api-key
   ```

5. **Run the application:**
   ```bash
   python app.py
   ```
   Access the dashboard at `http://127.0.0.1:5000`.

---

## Running with Docker

EuroTrip includes Docker configuration for reproducible deployment:

```bash
# Build and run with Docker Compose
docker compose up -d --build

# View logs
docker compose logs -f
```

---

## Running Tests

Run the complete test suite:

```bash
python -m unittest discover tests
```

---

## Security & Privacy

- All credentials and API keys are strictly configured via environment variables (`.env`).
- Secrets and runtime logs are excluded from source control via `.gitignore` and `.dockerignore`.
- Session tokens use HMAC digest verification and HttpOnly cookies.

---

## License

This project is licensed under the [MIT License](LICENSE).

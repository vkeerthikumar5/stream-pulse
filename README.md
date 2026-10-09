# Stream Pulse

Stream nearby aircraft positions from the free ADSB.lol API through Kafka to
OpenSearch, SQLite, and a local or AWS S3 data lake. A React dashboard reads
the latest flight positions from OpenSearch.

## Requirements

- Node.js 20 or newer and npm
- Docker with Docker Compose
- Outbound HTTPS access to `api.adsb.lol`

No ADSB.lol API key or account is required.

## Setup

Install JavaScript dependencies:

```bash
npm ci
```

Optionally create a local environment file from the example:

```bash
cp .env.example .env
```

The defaults work with the included Docker Compose setup. `.env` is ignored by
Git; keep credentials and other local settings there, not in committed files.

Start Kafka and OpenSearch:

```bash
docker compose up -d kafka opensearch
docker compose ps
```

Wait for Kafka to report healthy. Its health check creates the
`flight-live-positions` topic and verifies its partition has a leader.

## Run the stream

Run each process in its own terminal:

```bash
npm run producer
npm run consumer:opensearch
npm run consumer:sql
npm run consumer:s3
```

The producer polls ADSB.lol every 10 seconds and publishes aircraft positions
to Kafka. It defaults to aircraft within 25 nautical miles of New York City.
Configure the center and radius in `.env`:

```dotenv
FLIGHT_LATITUDE=37.7749
FLIGHT_LONGITUDE=-122.4194
FLIGHT_RADIUS_NM=25
FLIGHT_POLL_INTERVAL_MS=10000
```

The example coordinates center on San Francisco. Latitude must be between -90
and 90, longitude between -180 and 180, radius between 1 and 250 nautical
miles, and polling interval at least 5000 milliseconds. The producer sends
flight details when available; fields such as aircraft description, operator,
or year built may be missing from an ADS-B report.

## Data destinations

- **Kafka:** `flight-live-positions`, with each event keyed by the aircraft's
  ICAO24 address.
- **OpenSearch:** the `flight-positions` index stores one latest document per
  aircraft.
- **SQLite:** the `FlightState` table in `streampulse.db` stores one latest row
  per aircraft. The table is created automatically and new metadata columns
  are added to an existing table. Set `SQLITE_DB_PATH` to change the file.
- **S3 archive:** by default, the consumer writes JSON arrays of 10,000 flight
  events under `data-lake-archive/date=YYYY-MM-DD/`. A local batch file is
  written only after it reaches that size. To upload batches to AWS S3 instead,
  set `S3_USE_AWS=true` and `S3_BUCKET_NAME`; provide AWS credentials through
  the standard AWS SDK credential chain.

OpenSearch and SQLite retain the latest state, not full flight history. The
archive stores each received update in batches.

## Dashboard

Keep the producer and OpenSearch consumer running, then start the dashboard:

```bash
npm run dashboard
```

Open the Vite URL printed in the terminal. The React app requests data from
OpenSearch through a same-origin Vite proxy, so the browser does not read the
SQLite file directly and OpenSearch does not need browser CORS access. The
dashboard refreshes every 10 seconds and shows a sector plot, current traffic
statistics, altitude distribution, and searchable aircraft details. It shows
only reports from the last two minutes; its traffic trend starts when the page
opens.

Create a static production build with:

```bash
npm run build:dashboard
```

The output is written to `dist/dashboard/`. When hosting the static files,
configure the web server to proxy `/opensearch` requests to OpenSearch. The Vite
proxy is for local development only.

## Configuration

See [.env.example](./.env.example) for supported local settings. Common
overrides include `KAFKA_BROKER` (default `localhost:9092`),
`OPENSEARCH_NODE` (default `http://localhost:9200`), `SQLITE_DB_PATH`, and the
`FLIGHT_*` settings above.
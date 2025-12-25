# Magic Mirror with Quran Integration

This project creates a "Hardware-Free" Test Bench for a MagicMirror system with Quran display capabilities, powered by a local LLM (Ollama) and Home Assistant for voice command interpretation.

## Components

1. **Ollama** - Local LLM for interpreting voice commands
2. **MagicMirror²** - Display framework running in server mode
3. **Python Bridge** - Flask server to handle commands and control the mirror
4. **Home Assistant** - Smart home hub for command processing

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/): For running Home Assistant
- [Python 3](https://www.python.org/downloads/): For the bridge script
- [Node.js](https://nodejs.org/): For running MagicMirror
- [Ollama](https://ollama.com): For local LLM capabilities

## Quick Start

This project includes utility scripts to help you get started quickly:

1. Run `setup.bat` to install dependencies and set up the environment
2. Run `start_all.bat` to start all services (Home Assistant, Python Bridge, and MagicMirror)
3. Open your browser to:
   - MagicMirror: http://localhost:8080
   - Home Assistant: http://localhost:8123
4. When finished, run `stop_all.bat` to shut down all services

## Detailed Setup Instructions

### Phase 1: Set up Ollama (AI Brain)

1. Download and install Ollama from [ollama.com](https://ollama.com)
2. Open your terminal and run: `ollama pull llama3.2:3b`
3. Test it by running:
   ```
   curl -d '{"model": "llama3.2:3b", "prompt": "Say hello", "stream": false}' http://localhost:11434/api/generate
   ```

### Phase 2: Set up MagicMirror

1. Clone the MagicMirror repository:
   ```
   git clone https://github.com/MichMich/MagicMirror
   cd MagicMirror
   npm install
   ```

2. Copy the config file:
   ```
   cp config/config.js.sample config/config.js
   ```

3. Copy the custom module:
   ```
   cp -r /path/to/this/project/magicmirror/modules/MMM-QuranEmbed MagicMirror/modules/
   ```

4. Copy our custom config.js to the MagicMirror directory

### Phase 3: Set up the Python Bridge

1. Install the required Python packages:
   ```
   cd bridge
   pip install -r requirements.txt
   ```

2. Run the bridge script:
   ```
   python quran_server.py
   ```

### Phase 4: Set up Home Assistant

1. Start Home Assistant using Docker Compose:
   ```
   docker-compose up -d
   ```

2. Open Home Assistant at http://localhost:8123 and create an account

## Testing the System

Once all components are running:

1. Arrange your screen with:
   - Left side: Browser showing MagicMirror (http://localhost:8080)
   - Right side: Browser showing Home Assistant (http://localhost:8123)
   - Bottom: Terminal running Python Bridge

2. In Home Assistant:
   - Go to Developer Tools > Services
   - Search for `rest_command.send_quran_request`
   - Click "YAML mode" and paste:
     ```yaml
     data:
       text: "open surah yasin"
     ```
   - Click "Call Service"

3. Watch as:
   - The Python Terminal shows the command processing
   - The MagicMirror browser displays Quran.com with Surah Yasin

## Deploying to Raspberry Pi

After testing on your PC, you can deploy to a Raspberry Pi by:

1. Installing the same prerequisites on the Pi
2. Transferring the project files
3. Updating network configurations as needed
4. Setting up auto-start scripts

## Troubleshooting

- If Home Assistant cannot connect to the Python Bridge, check your firewall settings
- If MagicMirror doesn't update, check the browser console for errors
- For Ollama connection issues, verify it's running with `curl http://localhost:11434/api/tags`

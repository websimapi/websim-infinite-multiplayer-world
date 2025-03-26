import * as THREE from 'three';
import {
  OrbitControls
} from 'three/examples/jsm/controls/OrbitControls';

import {
  CHUNK_SIZE,
  WORLD_HEIGHT,
  SEA_LEVEL,
  mountainsColor,
  grassColor,
  sandColor,
  waterColor
} from './config.js'; // Assuming config.js is in the same directory

// Initialize WebsimSocket
const room = new WebsimSocket();

// Scene setup
let scene, camera, renderer, controls;
let chunkMap = new Map(); // Map to store loaded chunks
let simplex = new SimplexNoise();

const CHUNK_GENERATION_RADIUS = 2; // Render chunks within this radius of the player

let presence = {};

let chatMessages = [];

let allObjects = [];

let currentChunk = {
  x: 0,
  z: 0
};

let player = {
  x: 0,
  z: 0,
}

const clock = new THREE.Clock();

let playerMesh;

async function init() {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(50, 50, 50);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('scene-container').appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Initial camera position

  // Room initialization
  await room.initialize();
  let myUsername = room.party.client.username;

  console.log("My Username:" + myUsername);

  // Create player mesh
  const playerGeometry = new THREE.BoxGeometry(1, 2, 1);
  const playerMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000
  }); // Red color for the player
  playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
  scene.add(playerMesh);

  // Setup presence updates
  room.party.subscribePresence((newPresence) => {
    presence = newPresence;
    updatePresenceCount();

    for (const clientId in presence) {
      if (clientId != room.party.client.id) {
        if (!allObjects.find((e) => e.clientId == clientId)) {
          const geometry = new THREE.BoxGeometry(1, 2, 1);
          const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.clientId = clientId;
          scene.add(mesh);
          allObjects.push(mesh)
        }
        let thisObject = allObjects.find((e) => e.clientId == clientId);
        if (presence[clientId].x) thisObject.position.x = presence[clientId].x;
        if (presence[clientId].z) thisObject.position.z = presence[clientId].z;
      }

    }

    // Remove objects that are no longer in the presence list

    for (let i = 0; i < allObjects.length; i++) {
      let thisObject = allObjects[i];
      if (!presence[thisObject.clientId]) {
        scene.remove(thisObject);
        allObjects.splice(i, 1);
      }
    }
  });


  // Initial chunk loading based on initial presence
  loadInitialChunks(0, 0);

  // Chat setup
  document.getElementById('chat-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const message = document.getElementById('chat-input').value;
      if (message.trim() !== '') {
        sendMessage(message);
        document.getElementById('chat-input').value = '';
      }
    }
  });

  room.onmessage = (event) => {
    const data = event.data;
    if (data.type === 'chatMessage') {
      displayMessage(data.sender, data.message);
    }
  };

  // Asset generation setup
  document.getElementById('generate-asset-button').addEventListener('click', async () => {
    const prompt = document.getElementById('asset-prompt').value;
    const result = await websim.imageGen({
      prompt: prompt,
      aspect_ratio: "1:1",
    });
    console.log(result);

    // Generate 2D image from prompt
    if (result && result.url) {
      // Create a sprite with the generated image
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(result.url, (texture) => {
        const spriteMaterial = new THREE.SpriteMaterial({
          map: texture
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.scale.set(5, 5, 1); // Adjust the size as needed
        scene.add(sprite);
        allObjects.push(sprite);
      });
    }
  });

  // Code generation setup
  document.getElementById('generate-code-button').addEventListener('click', () => {
    const prompt = document.getElementById('code-prompt').value;
    generateCode(prompt);
  });

  window.addEventListener('resize', onWindowResize, false);

  animate();
}

// Chunk handling functions
function generateChunk(chunkX, chunkZ) {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const normals = [];
  const colors = [];

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const worldX = x + chunkX * CHUNK_SIZE;
      const worldZ = z + chunkZ * CHUNK_SIZE;
      const y = calculateTerrainHeight(worldX, worldZ);

      vertices.push(worldX, y, worldZ);

      // Calculate normals (simplified)
      normals.push(0, 1, 0);

      // Determine color based on height
      let color;
      if (y > SEA_LEVEL + 5) {
        color = mountainsColor; // Mountains
      } else if (y > SEA_LEVEL) {
        color = grassColor; // Grass
      } else if (y > SEA_LEVEL - 2) {
        color = sandColor; // Sand
      } else {
        color = waterColor; // Water
      }

      colors.push(color.r, color.g, color.b); // Use the hexToRgb function
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  // Create indices for triangles
  const indices = [];
  for (let x = 0; x < CHUNK_SIZE - 1; x++) {
    for (let z = 0; z < CHUNK_SIZE - 1; z++) {
      const a = x + z * CHUNK_SIZE;
      const b = (x + 1) + z * CHUNK_SIZE;
      const c = x + (z + 1) * CHUNK_SIZE;
      const d = (x + 1) + (z + 1) * CHUNK_SIZE;

      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  geometry.setIndex(indices);
  geometry.computeVertexNormals(); // Ensure normals are computed

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    flatShading: true
  });

  const chunk = new THREE.Mesh(geometry, material);
  chunk.position.set(chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE); // Position the chunk
  scene.add(chunk);
  return chunk;
}

function calculateTerrainHeight(x, z) {
  // Use simplex noise to generate terrain height
  let elevation = simplex.noise2D(x / 50, z / 50) * 15; // Base terrain
  elevation += simplex.noise2D(x / 20, z / 20) * 5; // Smaller details
  elevation += simplex.noise2D(x / 10, z / 10) * 2; // Tiny details

  // Ensure the terrain is above the "sea level"
  return elevation + SEA_LEVEL;
}

function loadChunk(chunkX, chunkZ) {
  if (!chunkMap.has(`${chunkX},${chunkZ}`)) {
    const chunk = generateChunk(chunkX, chunkZ);
    chunkMap.set(`${chunkX},${chunkZ}`, chunk);
  }
}

function unloadChunk(chunkX, chunkZ) {
  if (chunkMap.has(`${chunkX},${chunkZ}`)) {
    const chunk = chunkMap.get(`${chunkX},${chunkZ}`);
    scene.remove(chunk);
    chunkMap.delete(`${chunkX},${chunkZ}`);
    chunk.geometry.dispose();
    chunk.material.dispose();
  }
}

function loadInitialChunks(playerX, playerZ) {
  const chunkX = Math.floor(playerX / CHUNK_SIZE);
  const chunkZ = Math.floor(playerZ / CHUNK_SIZE);

  // Load chunks around the initial position
  for (let x = -CHUNK_GENERATION_RADIUS; x <= CHUNK_GENERATION_RADIUS; x++) {
    for (let z = -CHUNK_GENERATION_RADIUS; z <= CHUNK_GENERATION_RADIUS; z++) {
      loadChunk(chunkX + x, chunkZ + z);
    }
  }
}

function updateChunks(playerX, playerZ) {
  const chunkX = Math.floor(playerX / CHUNK_SIZE);
  const chunkZ = Math.floor(playerZ / CHUNK_SIZE);

  // Unload chunks that are too far away
  for (const key of chunkMap.keys()) {
    const [x, z] = key.split(',').map(Number);
    const distance = Math.max(Math.abs(x - chunkX), Math.abs(z - chunkZ));
    if (distance > CHUNK_GENERATION_RADIUS) {
      unloadChunk(x, z);
    }
  }

  // Load new chunks
  for (let x = -CHUNK_GENERATION_RADIUS; x <= CHUNK_GENERATION_RADIUS; x++) {
    for (let z = -CHUNK_GENERATION_RADIUS; z <= CHUNK_GENERATION_RADIUS; z++) {
      loadChunk(chunkX + x, chunkZ + z);
    }
  }

  currentChunk.x = chunkX;
  currentChunk.z = chunkZ;

}


// Chat functions
function sendMessage(message) {
  // Send the message to the server
  room.send({
    type: 'chatMessage',
    message: message,
    sender: room.party.client.username
  });

  // Optimistically display the message locally
  displayMessage(room.party.client.username, message);
}

function displayMessage(sender, message) {
  const chatMessagesDiv = document.getElementById('chat-messages');
  const messageDiv = document.createElement('div');
  messageDiv.classList.add('message');
  messageDiv.textContent = `${sender}: ${message}`;
  chatMessagesDiv.appendChild(messageDiv);

  // Scroll to the bottom to show the latest message
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

// Presence functions
function updatePresenceCount() {
  const presenceCountSpan = document.getElementById('presence-count');
  presenceCountSpan.textContent = Object.keys(presence).length;
}

// Code Generation
async function generateCode(prompt) {
  const completion = await websim.chat.completions.create({
    messages: [{
      role: "user",
      content: prompt
    }],
  });

  // Use the generated code (for example, display it in an alert)
  alert("Generated Code:\n" + completion.content);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  // update player location based on keystrokes
  let delta = clock.getDelta();
  let moveDistance = 10 * delta; // 200 pixels per second
  let rotateAngle = Math.PI / 2 * delta; // pi/2 radians (90 degrees) per second
  // Handle user input (example: WASD keys for movement)
  if (presence[room.party.client.id]) {
    //update presence location based on player location
    room.party.updatePresence({
      x: player.x,
      z: player.z,
    });
  }

  // Chunk updates
  updateChunks(player.x, player.z);

  // Move player
  player.x += 0.05;
  player.z += 0.05;

  if (playerMesh) {
    playerMesh.position.x = player.x;
    playerMesh.position.z = player.z;
  }


  controls.update(); // Required if controls.enableDamping or controls.autoRotate are set to true

  renderer.render(scene, camera);
}

init();


export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    status: 'cloud_mode',
    environment: 'vercel_serverless',
    message: 'Diese Applikation laeuft aktuell in der Vercel Cloud-Umgebung.',
    explanation: 'Cloud-Server (Vercel/AWS) haben keinen physischen Zugriff auf dein lokales Heimnetzwerk (192.168.x.x / 169.254.x.x) oder dein Direkt-LAN-Kabel.',
    solution: {
      option1: 'Empfohlen (Offline / Direktkabel): Starte das Tool lokal auf deinem PC mit start.bat und rufe http://localhost:3000 auf.',
      option2: 'Fuer Vercel-Nutzung: Starte lokal start-tunnel.bat und trage die erzeugte HTTPS-Bridge-URL im Vercel-Dashboard ein.'
    }
  });
}

# REP
Rush Event Pilot

Concept
Outil de coordination vidéo pour tournages événementiels multi-cadreurs. Le réalisateur prépare un plan de tournage (pré-script Markdown), le partage via un ID projet, et chaque cadreur upload ses rushs depuis une PWA légère avec une description libre. Un LLM local associe automatiquement chaque rush au plan correspondant, et le réalisateur suit la couverture en temps réel sur une timeline visuelle.
Solution technique
Backend : FastAPI + SQLite, architecture app/ (logique métier, routers) séparée de server/ (entrypoint), auth JWT pour le réalisateur, accès par ID projet seul pour les cadreurs
Matching intelligent : Qwen2.5:3b via Ollama en local, double stratégie LLM + fallback mots-clés, exécuté automatiquement à chaque upload
Frontend réalisateur : JS vanilla connecté à l'API REST, timeline interactive avec statut "pourvu" par bloc
Infra : VM Scaleway (2 vCPU / 8 Go RAM), tout le développement piloté depuis un smartphone Android via Termux + SSH
Compétences déployées
Développement backend Python (FastAPI, SQLite, JWT)
Intégration LLM locale (Ollama) pour tâche de classification/matching textuel
Architecture logicielle (séparation des responsabilités, API REST)
Debugging système à distance en CLI pur (sans IDE ni DevTools classiques)
Frontend vanilla JS (fetch API, gestion d'état, DOM dynamique)
Administration serveur Linux / cloud (VM, sécurité réseau, gestion de services)

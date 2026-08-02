# Contador de Salas

Sistema web para contagem de alunos por sala (EMEF), com banco de dados próprio.

## Como rodar

1. Instale as dependências (só na primeira vez):
   ```
   npm install
   ```
2. Inicie o servidor:
   ```
   npm start
   ```
3. Abra no navegador: http://localhost:3000

## Onde ficam os dados

Os registros são salvos em `data/registros.json`, na pasta do projeto.
Esse arquivo é o "banco de dados" do sistema — faça backup dele periodicamente.

## Acesso pelo celular (mesma rede Wi-Fi)

Descubra o IP do computador (ex: 192.168.0.10) e acesse, no celular:
```
http://192.168.0.10:3000
```

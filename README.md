# Vatsim Tracker

This application utilizes Leaflet to display live **VATSIM** data. You can search for Callsigns or click on Aircraft to see where they are in the (virtual) world.

![VATSIM Tracker](https://github.com/incarnateTheGreat/vatsim/blob/master/vatsimTracker.png?raw=true)

## Requirements to Operate

In order for the application to function, three functions need to be active:

1. React Dev server

2. Express server (operates Express connection to React Dev server and GraphQL)

3. MongoDB server

## Installation

Run the following from the Command Line:

```
git clone https://github.com/incarnateTheGreat/vatsim-tracker

cd vatsim-tracker
```

Once the above steps are complete, download the latest dependencies by running:

```
npm install
```

## Development Server

1. From the Command Line, run `npm start`.

2. Navigate to `http://localhost:3030/`.

## Information Server

In order to gather VATSIM and Airport data, you need to have an Express Server running in the background.

1. From the Command Line, open a new tab.

2. Go to `server`.

3. Run `node server.js`, or use **nodemon** by running `nodemon server.js`.

4. Should prompt `Express & GraphQL servers started!` shortly afterwards.

## MongoDB Server

In order to call **Airport Data**, specifically the **ICAO** codes,
all data is kept in a MongoDB Collection called **Airports**.

To download and set up MongoDB:

1. Run `brew install mongodb` (and then `brew update mongodb`, if necessary).

NOTE: If you do not have a `/data/db` path in your device, please create one: `sudo mkdir -p /data/db`.

2. Prior to starting **MongoDB**, the `/data/db` path needs access rights (NOT the local `data` path in the project): run `sudo chmod -R go+w /data/db`.

3. If you are using Mac OS Catalina, you cannot simply start `mongod` because you can no longer assign a data directory. Therefore, you will have to start the process
   by navigating to root folder and typing: `mongod --dbpath=src/data/db`

4. To apply the **Airports** JSON data to the database, do the following:

- navigate to the `src/data` folder,
- make sure that you have the latest `airports.json` file,
- make sure Mongo is active and running (preferably executed in a separate Terminal window),
- and run: `mongoimport --db airports --collection airports --file airports.json --jsonArray`

If this is successful, you will see the following: `connected to: localhost imported [number] documents`

5. To apply the **FIR** JSON data to the database, do the following:

- navigate to the `src/data` folder,
- make sure that you have the latest `fir-boundaries.json` file,
- make sure Mongo is active and running (preferably executed in a separate Terminal window),
- and run: `mongoimport --db airports --collection fir --file fir-boundaries.json --jsonArray`

If this is successful, you will see the following: `connected to: localhost imported [number] documents`

6. An easy way to interface with the database is to use **Robo-3T** (formerly known as **RoboMongo**). Install the program and then apply the database.

## Tech Stack

Using:

- React (to run the Dev server and operate all front-end technology)
- Leaflet (to draw Map, specifically using React Leaflet)
- Axios (to fetch data)
- Express (to run backend server)
- MongoDB (to operate no-sql queries)
- RoboMongo/Robo-3T (for interfacing with the MongoDB database)
- GraphQL (to refine above queries and return data quickly

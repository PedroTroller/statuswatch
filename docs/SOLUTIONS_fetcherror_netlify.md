async function fetchData(endpoint) {
    const response = await fetch(endpoint); 
    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return response.json(); // Assuming JSON data retrieval
}
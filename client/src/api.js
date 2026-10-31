const API_BASE_URL = (
    import.meta.env.VITE_API_URL || "http://localhost:5000"
).replace(/\/$/, "");

export function apiUrl(path = "") {
    if (/^https?:\/\//i.test(path)) {
        return path;
    }

    return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiFetch(path, options = {}) {
    const response = await fetch(apiUrl(path), options);

    return response;
}

export async function apiJson(path, options = {}) {
    const response = await apiFetch(path, options);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const error = new Error(
            data.error || `Request failed with status ${response.status}`
        );

        error.status = response.status;
        error.data = data;

        throw error;
    }

    return data;
}

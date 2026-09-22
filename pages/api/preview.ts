import type { NextApiRequest, NextApiResponse } from "next";
import formidable, { File } from "formidable";
import fs from "fs/promises";

export const config = {
  api: {
    bodyParser: false,
  },
};

type ParsedRequest = {
  fields: formidable.Fields;
  files: formidable.Files;
};

async function parse(req: NextApiRequest): Promise<ParsedRequest> {
  return await new Promise((resolve, reject) => {
    formidable({
      maxFileSize: 5 * 1024 * 1024,
      multiples: false,
    }).parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ fields, files });
    });
  });
}

function fieldValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}

function dataUriToBase64(uri: string): string {
  const comma = uri.indexOf(",");
  if (comma === -1) {
    throw new Error("Invalid data URI");
  }
  return uri.slice(comma + 1);
}

async function readImage(file: File) {
  const buffer = await fs.readFile(file.filepath);
  const mime = file.mimetype || "image/jpeg";
  const dataUri = `data:${mime};base64,${buffer.toString("base64")}`;

  return {
    buffer,
    mime,
    dataUri,
  };
}

function extractImageFromOpenAIResponse(data: any): string | null {
  const item = data?.data?.[0];

  if (item?.url) return item.url;
  if (item?.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }

  return null;
}

function extractImageFromAIMLResponse(data: any): string | null {
  const item = data?.data?.[0] ?? data?.images?.[0];

  if (item?.url) return item.url;
  if (item?.b64_json) {
    return `data:image/png;base64,${item.b64_json}`;
  }

  return null;
}

function extractImageFromRunwareResponse(data: any): string | null {
  const item = data?.data?.find(
    (entry: any) => entry?.taskType === "imageInference"
  ) ?? data?.data?.[0];

  if (item?.imageURL) return item.imageURL;
  if (item?.imageDataURI) return item.imageDataURI;
  if (item?.imageBase64Data) {
    return `data:image/png;base64,${item.imageBase64Data}`;
  }

  return null;
}

async function callRunware(
  key: string,
  file: File,
  prompt: string
): Promise<string> {
  const { dataUri } = await readImage(file);

  const body = [
    {
      taskType: "imageInference",
      taskUUID: crypto.randomUUID(),
      model: "bfl:3@1",
      positivePrompt: prompt,
      width: 1024,
      height: 1024,
      numberResults: 1,
      outputType: ["URL"],
      outputFormat: "JPG",
      inputs: {
        referenceImages: [dataUri],
      },
    },
  ];

  console.log("[Runware] starting");

  const response = await fetch("https://api.runware.ai/v1", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  if (!response.ok) {
    console.error("[Runware]", response.status, text);
    throw new Error(`Runware ${response.status}: ${text.slice(0, 500)}`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Runware returned invalid JSON");
  }

  const image = extractImageFromRunwareResponse(data);

  if (!image) {
    console.error("[Runware] no image:", data);
    throw new Error("Runware returned no image");
  }

  return image;
}

async function callSiliconFlow(
  key: string,
  file: File,
  prompt: string
): Promise<string> {
  const { dataUri } = await readImage(file);

  const body = {
    model: "Qwen/Qwen-Image-Edit",
    prompt,
    image: dataUri,
  };

  console.log("[SiliconFlow] starting");

  const response = await fetch(
    "https://api.siliconflow.cn/v1/images/generations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Enable-Watermark": "0",
      },
      body: JSON.stringify(body),
    }
  );

  const text = await response.text();

  if (!response.ok) {
    console.error("[SiliconFlow]", response.status, text);
    throw new Error(
      `SiliconFlow ${response.status}: ${text.slice(0, 500)}`
    );
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("SiliconFlow returned invalid JSON");
  }

  const image = extractImageFromOpenAIResponse(data);

  if (!image) {
    console.error("[SiliconFlow] no image:", data);
    throw new Error("SiliconFlow returned no image");
  }

  return image;
}

async function callAIMLAPI(
  key: string,
  file: File,
  prompt: string
): Promise<string> {
  const { dataUri } = await readImage(file);

  const body = {
    model: "flux/kontext-pro/image-to-image",
    prompt,
    image_url: dataUri,
    num_images: 1,
    output_format: "jpeg",
    aspect_ratio: "1:1",
  };

  console.log("[AIMLAPI] starting");

  const response = await fetch(
    "https://api.aimlapi.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const text = await response.text();

  if (!response.ok) {
    console.error("[AIMLAPI]", response.status, text);
    throw new Error(`AIMLAPI ${response.status}: ${text.slice(0, 500)}`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("AIMLAPI returned invalid JSON");
  }

  const image = extractImageFromAIMLResponse(data);

  if (!image) {
    console.error("[AIMLAPI] no image:", data);
    throw new Error("AIMLAPI returned no image");
  }

  return image;
}

async function callPollinations(
  key: string,
  file: File,
  prompt: string
): Promise<string> {
  const { buffer, mime } = await readImage(file);

  const form = new FormData();

  form.append(
    "image",
    new Blob([buffer], {
      type: mime,
    }),
    file.originalFilename || "input.jpg"
  );
  form.append("prompt", prompt);
  form.append("model", "kontext");
  form.append("size", "1024x1024");
  form.append("response_format", "url");

  console.log("[Pollinations] starting");

  const response = await fetch(
    "https://gen.pollinations.ai/v1/images/edits",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
      },
      body: form,
    }
  );

  const text = await response.text();

  if (!response.ok) {
    console.error("[Pollinations]", response.status, text);
    throw new Error(
      `Pollinations ${response.status}: ${text.slice(0, 500)}`
    );
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Pollinations returned invalid JSON");
  }

  const image = extractImageFromOpenAIResponse(data);

  if (!image) {
    console.error("[Pollinations] no image:", data);
    throw new Error("Pollinations returned no image");
  }

  return image;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const parsed = await parse(req);

    const uploaded = parsed.files.image as File | File[];
    const file = Array.isArray(uploaded) ? uploaded[0] : uploaded;

    if (!file) {
      return res.status(400).json({
        error: "فقط عکس JPG و PNG قابل قبول است",
      });
    }

    const service = fieldValue(parsed.fields.service);
    const style = fieldValue(parsed.fields.style);
    const color = fieldValue(parsed.fields.color);

    const prompt = service.includes("میکرو")
      ? `Apply ${style} microblading eyebrows with ${color} color on this face. Keep the entire face, identity, skin, hair, eyes, nose, mouth, facial structure, lighting, camera angle and background identical to the input image. Only modify the eyebrows. Create a natural healed microblading result with realistic individual hair strokes and professional permanent makeup quality. Do not change any other part of the image.`
      : service.includes("خط چشم")
        ? `Apply ${style} permanent eyeliner with ${color} color on this face. Keep the entire face, identity, skin, hair, eyes, nose, mouth, facial structure, lighting, camera angle and background identical to the input image. Only modify the eyeliner area. Create a natural healed permanent makeup result with realistic professional detail. Do not change any other part of the image.`
        : `Apply ${style} lip shading with ${color} color on this face. Keep the entire face, identity, skin, hair, eyes, nose, mouth, facial structure, lighting, camera angle and background identical to the input image. Only modify the lips. Create a natural healed permanent makeup result with realistic professional detail. Do not change any other part of the image.`;

    console.log("[Preview] prompt:", prompt);

    const attempts: Array<{
      name: string;
      key: string | undefined;
      call: () => Promise<string>;
    }> = [
      {
        name: "Runware",
        key: process.env.RUNWARE_API_KEY,
        call: () =>
          callRunware(process.env.RUNWARE_API_KEY as string, file, prompt),
      },
      {
        name: "SiliconFlow",
        key: process.env.SILICONFLOW_API_KEY,
        call: () =>
          callSiliconFlow(
            process.env.SILICONFLOW_API_KEY as string,
            file,
            prompt
          ),
      },
      {
        name: "AIMLAPI",
        key: process.env.AIMLAPI_API_KEY,
        call: () =>
          callAIMLAPI(
            process.env.AIMLAPI_API_KEY as string,
            file,
            prompt
          ),
      },
      {
        name: "Pollinations",
        key: process.env.POLLINATIONS_API_KEY,
        call: () =>
          callPollinations(
            process.env.POLLINATIONS_API_KEY as string,
            file,
            prompt
          ),
      },
    ];

    const errors: string[] = [];

    for (const attempt of attempts) {
      if (!attempt.key) {
        console.log(`[${attempt.name}] skipped: API key missing`);
        continue;
      }

      try {
        const url = await attempt.call();

        console.log(`[${attempt.name}] SUCCESS`);

        return res.status(200).json({
          url,
          provider: attempt.name,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        console.error(`[${attempt.name}] FAILED:`, message);
        errors.push(`${attempt.name}: ${message}`);
      }
    }

    return res.status(502).json({
      error: "همه سرویس‌های تولید تصویر ناموفق بودند",
      details: errors,
    });
  } catch (error) {
    console.error("[Preview] fatal error:", error);

    return res.status(500).json({
      error: "خطا در پردازش تصویر",
    });
  }
}
